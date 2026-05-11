import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAnnotation as createStudyAnnotation,
  deleteAnnotation as deleteStudyAnnotation,
  listAnnotations,
  updateAnnotation as updateStudyAnnotation,
} from "../api/annotations";
import { queryKeys } from "../realtime/queryKeys";
import type { Annotation } from "../types";

/**
 * Annotation positioning is defined in a flat "rendered text" coordinate space,
 * not by markdown AST nodes or DOM paths.
 *
 * The algorithm is:
 * 1. Render study markdown with react-markdown.
 * 2. Walk the rendered DOM text nodes in document order and assign each a
 *    half-open [start, end) range in one continuous text stream.
 * 3. Persist annotations as offsets within that stream.
 * 4. Reconstruct highlights by mapping persisted offsets back onto the current
 *    DOM text nodes and wrapping only the overlapping slices.
 * 5. Convert browser selections back into the same offset space before saving.
 *
 * The critical invariant is that selection capture and highlight rendering must
 * use the exact same traversal rules, otherwise offsets drift and annotations
 * land on the wrong text after reload. Any UI-only injected text must therefore
 * be excluded from the text walker.
 */
export interface SelectionDraft {
  rendered_text_start_offset: number;
  rendered_text_end_offset: number;
  rendered_text: string;
  pointer_x: number;
  pointer_y: number;
  x: number;
  y: number;
}

export interface AnnotationPopoverState {
  mode: "selection" | "create" | "view" | "edit";
  x: number;
  y: number;
  placement: "above" | "below";
  draft?: SelectionDraft;
  annotation?: Annotation;
}

interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

function anchorFromPointer(
  pointerX: number,
  pointerY: number,
) {
  const minAboveSpace = 180;
  const placement = pointerY < minAboveSpace ? "below" as const : "above" as const;
  return {
    x: pointerX + 2,
    y: placement === "below" ? pointerY + 6 : pointerY - 4,
    placement,
  };
}

function anchorFromElement(element: Element) {
  const rect = element.getBoundingClientRect();
  const anchorX = Math.min(rect.left + Math.min(rect.width / 2, 32), window.innerWidth - 24);
  const anchorY = rect.top < 180 ? rect.bottom : rect.top;
  return anchorFromPointer(anchorX, anchorY);
}

function rangesOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return startA < endB && endA > startB;
}

function unwrapHighlights(root: HTMLElement) {
  for (const span of root.querySelectorAll("span.study-annotation-highlight")) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
    parent.normalize();
  }
}

function clearTemporarySelectionHighlight(root: HTMLElement) {
  for (const span of root.querySelectorAll("span.study-annotation-selection-highlight")) {
    const parent = span.parentNode;
    if (!parent) continue;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
    parent.normalize();
  }
}

function collectTextSegments(root: HTMLElement): TextSegment[] {
  // This walker defines the canonical rendered-text coordinate space used by
  // both persisted annotations and live selection capture. Keep its inclusion
  // rules stable or stored offsets will no longer point at the intended text.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || node.nodeValue.length === 0) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(".back-to-top")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const segments: TextSegment[] = [];
  let cursor = 0;
  let current = walker.nextNode();
  while (current) {
    const node = current as Text;
    const text = node.nodeValue ?? "";
    segments.push({ node, start: cursor, end: cursor + text.length });
    cursor += text.length;
    current = walker.nextNode();
  }
  return segments;
}


/**
 * Wrap the portion of each text segment that falls within [startOffset, endOffset)
 * in a <span> with the given class/attributes. Works by splitting text nodes in-place
 * rather than using extractContents(), so element structure (block boundaries, headings)
 * is never disturbed and React's virtual DOM stays in sync.
 */
function wrapTextSegments(
  segments: TextSegment[],
  startOffset: number,
  endOffset: number,
  makeSpan: () => HTMLSpanElement,
) {
  // Callers must pass segments collected from the current DOM state. This
  // function mutates text nodes in place via splitText(), so reusing a segment
  // list across multiple wraps can leave later operations pointing at stale
  // node lengths or detached nodes.
  for (const seg of segments) {
    if (seg.end <= startOffset || seg.start >= endOffset) continue;

    const localStart = Math.max(startOffset, seg.start) - seg.start;
    const localEnd = Math.min(endOffset, seg.end) - seg.start;

    // Split off any text before the highlight region
    let targetNode: Text = seg.node;
    if (localStart > 0) {
      targetNode = seg.node.splitText(localStart);
    }
    // Split off any text after the highlight region
    if (localEnd - localStart < targetNode.nodeValue!.length) {
      targetNode.splitText(localEnd - localStart);
    }

    const span = makeSpan();
    targetNode.parentNode!.insertBefore(span, targetNode);
    span.appendChild(targetNode);
  }
}

function applyHighlights(root: HTMLElement, annotations: Annotation[]) {
  unwrapHighlights(root);
  if (annotations.length === 0) return;

  const sorted = [...annotations].sort(
    (a, b) => a.rendered_text_start_offset - b.rendered_text_start_offset,
  );

  for (const annotation of sorted) {
    // Recompute segments for each annotation because every wrap mutates the DOM
    // text-node structure that later annotations need to target.
    wrapTextSegments(
      collectTextSegments(root),
      annotation.rendered_text_start_offset,
      annotation.rendered_text_end_offset,
      () => {
        const span = document.createElement("span");
        span.className = "study-annotation-highlight";
        span.dataset.annotationId = String(annotation.id);
        span.title = "View annotation";
        return span;
      },
    );
  }
}

function applyTemporarySelectionHighlight(
  root: HTMLElement,
  startOffset: number,
  endOffset: number,
) {
  clearTemporarySelectionHighlight(root);
  const segments = collectTextSegments(root);
  wrapTextSegments(segments, startOffset, endOffset, () => {
    const span = document.createElement("span");
    span.className = "study-annotation-selection-highlight";
    return span;
  });
}

export function useStudyAnnotations(
  ideaSlug: string | null | undefined,
  selectedStudy: number | null,
  activeStudyContent: string | null | undefined,
  scrollToAnnotationId: number | null = null,
  onScrollToAnnotationHandled?: () => void,
) {
  const queryClient = useQueryClient();
  const [annotationBody, setAnnotationBody] = useState("");
  const [annotationPopover, setAnnotationPopover] = useState<AnnotationPopoverState | null>(null);
  const studyProseRef = useRef<HTMLDivElement>(null);

  const annotationsQuery = useQuery({
    queryKey: ideaSlug && selectedStudy ? queryKeys.studyAnnotations(ideaSlug, selectedStudy) : ["study-annotations", "disabled"],
    queryFn: ({ signal }) => {
      if (!ideaSlug || !selectedStudy) return Promise.resolve([] as Annotation[]);
      return listAnnotations(ideaSlug, selectedStudy, signal);
    },
    enabled: Boolean(ideaSlug && selectedStudy),
    staleTime: Infinity,
  });

  const annotations = annotationsQuery.data ?? [];
  const annotationLoading = annotationsQuery.isLoading;

  const createMutation = useMutation({
    mutationFn: (input: {
      ideaSlug: string;
      selectedStudy: number;
      payload: {
        rendered_text_start_offset: number;
        rendered_text_end_offset: number;
        rendered_text: string;
        body: string;
      };
    }) => createStudyAnnotation(input.ideaSlug, input.selectedStudy, input.payload),
  });

  const updateMutation = useMutation({
    mutationFn: ({ annotationId, body }: { annotationId: number; body: string }) =>
      updateStudyAnnotation(annotationId, body),
  });

  const deleteMutation = useMutation({
    mutationFn: (annotationId: number) => deleteStudyAnnotation(annotationId),
  });

  useEffect(() => {
    setAnnotationPopover(null);
    setAnnotationBody("");
    if (!ideaSlug || !selectedStudy) {
      return;
    }
  }, [ideaSlug, selectedStudy]);

  useEffect(() => {
    const root = studyProseRef.current;
    if (!activeStudyContent || !root) return;

    applyHighlights(root, annotations);
    if (annotationPopover?.mode === "create" && annotationPopover.draft) {
      applyTemporarySelectionHighlight(
        root,
        annotationPopover.draft.rendered_text_start_offset,
        annotationPopover.draft.rendered_text_end_offset,
      );
    } else {
      clearTemporarySelectionHighlight(root);
    }
    return () => {
      clearTemporarySelectionHighlight(root);
      unwrapHighlights(root);
    };
  }, [activeStudyContent, annotations, annotationPopover]);

  useEffect(() => {
    if (!scrollToAnnotationId || !studyProseRef.current || !activeStudyContent || annotations.length === 0) return;
    const frame = requestAnimationFrame(() => {
      const annotation = annotations.find((a) => a.id === scrollToAnnotationId);
      const span = studyProseRef.current?.querySelector(
        `span.study-annotation-highlight[data-annotation-id="${scrollToAnnotationId}"]`,
      );
      if (!span || !annotation) return;
      // Treat scrollToAnnotationId as a one-shot trigger. We only clear it
      // after a successful lookup so initial loads can retry until highlights
      // exist, but later annotation state changes do not retrigger the jump.
      span.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
      const anchor = anchorFromElement(span);
      setAnnotationPopover({
        mode: "view",
        x: anchor.x,
        y: anchor.y,
        placement: anchor.placement,
        annotation,
      });
      setAnnotationBody(annotation.body);
      onScrollToAnnotationHandled?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [activeStudyContent, annotations, onScrollToAnnotationHandled, scrollToAnnotationId]);

  useEffect(() => {
    if (!annotationPopover) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (
        !target.closest(".annotation-popover") &&
        !target.closest(".study-annotation-highlight")
      ) {
        setAnnotationPopover(null);
        setAnnotationBody("");
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAnnotationPopover(null);
        setAnnotationBody("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [annotationPopover]);

  const activeAnnotation = useMemo(
    () => annotationPopover?.annotation ?? null,
    [annotationPopover],
  );

  const handleStudySelection = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeStudyContent || !studyProseRef.current) return;
    const pointerX = e.clientX;
    const pointerY = e.clientY;
    requestAnimationFrame(() => {
      const anchor = anchorFromPointer(pointerX, pointerY);
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return;
      }
      const range = selection.getRangeAt(0);
      const root = studyProseRef.current;
      if (!root) return;
      if (!root.contains(range.commonAncestorContainer)) {
        return;
      }
      if (!selection.toString().trim()) {
        setAnnotationPopover(null);
        return;
      }

      // Convert the browser Range back into the same flat rendered-text
      // coordinate space used by persisted annotations. The walker and its
      // exclusions must stay in sync with applyHighlights().
      //
      // range.isPointInRange() handles selections whose endpoints are element
      // nodes rather than text nodes, such as selections that cross markup
      // boundaries or section structure.
      const segments = collectTextSegments(root);
      let start = -1;
      let end = -1;
      for (const segment of segments) {
        const nodeLen = segment.node.nodeValue?.length ?? 0;
        if (start === -1) {
          if (segment.node === range.startContainer) {
            start = segment.start + range.startOffset;
          } else if (range.isPointInRange(segment.node, 0)) {
            // startContainer is an element ancestor; this text node is the first one in the range
            start = segment.start;
          }
        }
        if (start !== -1) {
          if (segment.node === range.endContainer) {
            end = segment.start + range.endOffset;
            break;
          } else if (!range.isPointInRange(segment.node, nodeLen)) {
            // endContainer is an element ancestor; this text node is the first one past the range
            end = segment.start;
            break;
          }
        }
      }
      // If we ran off the end of segments without finding endContainer, end is still unset
      if (start !== -1 && end === -1 && segments.length > 0) {
        const last = segments[segments.length - 1];
        end = last.end;
      }
      if (start === -1 || end === -1 || start >= end) {
        setAnnotationPopover(null);
        return;
      }
      const renderedText = segments
        .filter((seg) => seg.start < end && seg.end > start)
        .map((seg) => {
          const s = Math.max(seg.start, start) - seg.start;
          const e = Math.min(seg.end, end) - seg.start;
          return (seg.node.nodeValue ?? "").slice(s, e);
        })
        .join("");
      if (
        annotations.some((item) =>
          rangesOverlap(
            item.rendered_text_start_offset,
            item.rendered_text_end_offset,
            start,
            end,
          ),
        )
      ) {
        setAnnotationPopover(null);
        return;
      }

      setAnnotationPopover({
        mode: "selection",
        x: anchor.x,
        y: anchor.y,
        placement: anchor.placement,
        draft: {
          rendered_text_start_offset: start,
          rendered_text_end_offset: end,
          rendered_text: renderedText,
          pointer_x: pointerX,
          pointer_y: pointerY,
          x: anchor.x,
          y: anchor.y,
        },
      });
      setAnnotationBody("");
    });
  }, [activeStudyContent, anchorFromPointer, annotations]);

  const handleStudyClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const highlight = target.closest(".study-annotation-highlight") as HTMLElement | null;
    if (!highlight) return;
    // Meta/Ctrl+click follows the link instead of opening the annotation popover
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    const id = Number(highlight.dataset.annotationId);
    const annotation = annotations.find((item) => item.id === id);
    if (!annotation) return;
    const anchor = anchorFromPointer(e.clientX, e.clientY);
    setAnnotationPopover({
      mode: "view",
      x: anchor.x,
      y: anchor.y,
      placement: anchor.placement,
      annotation,
    });
    setAnnotationBody(annotation.body);
  }, [anchorFromPointer, annotations]);

  const beginCreate = useCallback(() => {
    if (!annotationPopover?.draft) return;
    const anchor = anchorFromPointer(
      annotationPopover.draft.pointer_x,
      annotationPopover.draft.pointer_y,
    );
    setAnnotationPopover({
      mode: "create",
      x: anchor.x,
      y: anchor.y,
      placement: anchor.placement,
      draft: annotationPopover.draft,
    });
    setAnnotationBody("");
  }, [anchorFromPointer, annotationPopover]);

  const cancelPopover = useCallback(() => {
    setAnnotationPopover(null);
    setAnnotationBody("");
  }, []);

  const startEdit = useCallback(() => {
    if (!annotationPopover?.annotation) return;
    setAnnotationPopover({
      mode: "edit",
      x: annotationPopover.x,
      y: annotationPopover.y,
      placement: annotationPopover.placement,
      annotation: annotationPopover.annotation,
    });
    setAnnotationBody(annotationPopover.annotation.body);
  }, [annotationPopover]);

  const cancelEdit = useCallback(() => {
    if (!activeAnnotation || !annotationPopover) return;
    setAnnotationPopover({
      mode: "view",
      x: annotationPopover.x,
      y: annotationPopover.y,
      placement: annotationPopover.placement,
      annotation: activeAnnotation,
    });
    setAnnotationBody(activeAnnotation.body);
  }, [activeAnnotation, annotationPopover]);

  const createAnnotation = useCallback(async () => {
    if (!ideaSlug || !selectedStudy || annotationPopover?.mode !== "create" || !annotationPopover.draft) return;
    const data = await createMutation.mutateAsync({
      ideaSlug,
      selectedStudy,
      payload: {
        rendered_text_start_offset: annotationPopover.draft.rendered_text_start_offset,
        rendered_text_end_offset: annotationPopover.draft.rendered_text_end_offset,
        rendered_text: annotationPopover.draft.rendered_text,
        body: annotationBody,
      },
    });
    queryClient.setQueryData(
      queryKeys.studyAnnotations(ideaSlug, selectedStudy),
      (current: Annotation[] | undefined) =>
        [...(current ?? []), data].sort(
          (a, b) => a.rendered_text_start_offset - b.rendered_text_start_offset,
        ),
    );
    setAnnotationPopover(null);
    setAnnotationBody("");
    window.getSelection()?.removeAllRanges();
  }, [annotationBody, annotationPopover, createMutation, ideaSlug, queryClient, selectedStudy]);

  const updateAnnotation = useCallback(async () => {
    if (!activeAnnotation || annotationPopover?.mode !== "edit") return;
    const data = await updateMutation.mutateAsync({ annotationId: activeAnnotation.id, body: annotationBody });
    if (ideaSlug && selectedStudy) {
      queryClient.setQueryData(
        queryKeys.studyAnnotations(ideaSlug, selectedStudy),
        (current: Annotation[] | undefined) =>
          (current ?? []).map((item) => (item.id === activeAnnotation.id ? data : item)),
      );
    }
    setAnnotationPopover({
      mode: "view",
      x: annotationPopover.x,
      y: annotationPopover.y,
      placement: annotationPopover.placement,
      annotation: data as Annotation,
    });
    setAnnotationBody((data as Annotation).body);
  }, [activeAnnotation, annotationBody, annotationPopover, ideaSlug, queryClient, selectedStudy, updateMutation]);

  const deleteAnnotation = useCallback(async () => {
    if (!activeAnnotation) return;
    await deleteMutation.mutateAsync(activeAnnotation.id);
    if (ideaSlug && selectedStudy) {
      queryClient.setQueryData(
        queryKeys.studyAnnotations(ideaSlug, selectedStudy),
        (current: Annotation[] | undefined) =>
          (current ?? []).filter((item) => item.id !== activeAnnotation.id),
      );
    }
    setAnnotationPopover(null);
    setAnnotationBody("");
  }, [activeAnnotation, deleteMutation, ideaSlug, queryClient, selectedStudy]);

  return {
    annotations,
    annotationLoading,
    annotationBody,
    annotationPopover,
    activeAnnotation,
    studyProseRef,
    setAnnotationBody,
    beginCreate,
    cancelEdit,
    cancelPopover,
    createAnnotation,
    deleteAnnotation,
    handleStudyClick,
    handleStudySelection,
    startEdit,
    updateAnnotation,
  };
}
