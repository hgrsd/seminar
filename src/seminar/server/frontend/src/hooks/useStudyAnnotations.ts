import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Annotation } from "../types";

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

  const segments = collectTextSegments(root);
  // Apply in document order so splitText offsets remain valid
  const sorted = [...annotations].sort(
    (a, b) => a.rendered_text_start_offset - b.rendered_text_start_offset,
  );

  for (const annotation of sorted) {
    wrapTextSegments(
      segments,
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
) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annotationLoading, setAnnotationLoading] = useState(false);
  const [annotationBody, setAnnotationBody] = useState("");
  const [annotationPopover, setAnnotationPopover] = useState<AnnotationPopoverState | null>(null);
  const studyProseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAnnotationPopover(null);
    setAnnotationBody("");
    if (!ideaSlug || !selectedStudy) {
      setAnnotations([]);
      setAnnotationLoading(false);
      return;
    }
    setAnnotationLoading(true);
    fetch(`/api/ideas/${ideaSlug}/studies/${selectedStudy}/annotations`)
      .then((r) => r.json())
      .then((data: Annotation[]) => setAnnotations(data))
      .catch(() => setAnnotations([]))
      .finally(() => setAnnotationLoading(false));
  }, [ideaSlug, selectedStudy]);

  useEffect(() => {
    if (!activeStudyContent || !studyProseRef.current) return;
    applyHighlights(studyProseRef.current, annotations);
    if (annotationPopover?.mode === "create" && annotationPopover.draft) {
      applyTemporarySelectionHighlight(
        studyProseRef.current,
        annotationPopover.draft.rendered_text_start_offset,
        annotationPopover.draft.rendered_text_end_offset,
      );
    } else {
      clearTemporarySelectionHighlight(studyProseRef.current);
    }
    return () => {
      if (studyProseRef.current) {
        clearTemporarySelectionHighlight(studyProseRef.current);
        unwrapHighlights(studyProseRef.current);
      }
    };
  }, [activeStudyContent, annotations, annotationPopover]);

  useEffect(() => {
    if (!annotationPopover) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
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

  const anchorFromPointer = useCallback((
    pointerX: number,
    pointerY: number,
  ) => {
    const minAboveSpace = 180;
    const placement = pointerY < minAboveSpace ? "below" as const : "above" as const;
    return {
      x: pointerX + 2,
      y: placement === "below" ? pointerY + 6 : pointerY - 4,
      placement,
    };
  }, []);

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

      // Compute offsets using the same text segment walker as applyHighlights/wrapTextSegments,
      // so that back-to-top and other excluded nodes are not counted.
      // We use range.isPointInRange to handle cases where startContainer/endContainer
      // is an element node rather than a text node (e.g. cross-section selections).
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
    const target = e.target as HTMLElement;
    const highlight = target.closest(".study-annotation-highlight") as HTMLElement | null;
    if (!highlight) return;
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
    const response = await fetch(`/api/ideas/${ideaSlug}/studies/${selectedStudy}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rendered_text_start_offset: annotationPopover.draft.rendered_text_start_offset,
        rendered_text_end_offset: annotationPopover.draft.rendered_text_end_offset,
        rendered_text: annotationPopover.draft.rendered_text,
        body: annotationBody,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
    setAnnotations((current) => [...current, data as Annotation].sort(
      (a, b) => a.rendered_text_start_offset - b.rendered_text_start_offset,
    ));
    setAnnotationPopover(null);
    setAnnotationBody("");
    window.getSelection()?.removeAllRanges();
  }, [annotationBody, annotationPopover, ideaSlug, selectedStudy]);

  const updateAnnotation = useCallback(async () => {
    if (!activeAnnotation || annotationPopover?.mode !== "edit") return;
    const response = await fetch(`/api/annotations/${activeAnnotation.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: annotationBody }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
    setAnnotations((current) =>
      current.map((item) => (item.id === activeAnnotation.id ? data as Annotation : item)),
    );
    setAnnotationPopover({
      mode: "view",
      x: annotationPopover.x,
      y: annotationPopover.y,
      placement: annotationPopover.placement,
      annotation: data as Annotation,
    });
    setAnnotationBody((data as Annotation).body);
  }, [activeAnnotation, annotationBody, annotationPopover]);

  const deleteAnnotation = useCallback(async () => {
    if (!activeAnnotation) return;
    const response = await fetch(`/api/annotations/${activeAnnotation.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed: ${response.status}`);
    }
    setAnnotations((current) => current.filter((item) => item.id !== activeAnnotation.id));
    setAnnotationPopover(null);
    setAnnotationBody("");
  }, [activeAnnotation]);

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
