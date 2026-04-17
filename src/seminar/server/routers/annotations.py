"""Study annotation endpoints."""

from dataclasses import asdict

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from seminar.server.dependencies import get_annotation_service
from seminar.service.annotations import AnnotationService

router = APIRouter(prefix="/api")


class CreateAnnotationRequest(BaseModel):
    rendered_text_start_offset: int = Field(ge=0)
    rendered_text_end_offset: int = Field(ge=0)
    rendered_text: str = Field(min_length=1)
    body: str = Field(min_length=1)


class UpdateAnnotationRequest(BaseModel):
    body: str = Field(min_length=1)


@router.get("/ideas/{slug}/studies/{study_number}/annotations")
def list_annotations(
    slug: str,
    study_number: int,
    annotations: AnnotationService = Depends(get_annotation_service),
):
    return [asdict(item) for item in annotations.list_for_study(slug, study_number)]


@router.post("/ideas/{slug}/studies/{study_number}/annotations")
def create_annotation(
    slug: str,
    study_number: int,
    req: CreateAnnotationRequest,
    annotations: AnnotationService = Depends(get_annotation_service),
):
    try:
        item = annotations.create(
            slug,
            study_number,
            req.rendered_text_start_offset,
            req.rendered_text_end_offset,
            req.rendered_text,
            req.body,
        )
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    return JSONResponse(asdict(item))


@router.put("/annotations/{annotation_id}")
def update_annotation(
    annotation_id: int,
    req: UpdateAnnotationRequest,
    annotations: AnnotationService = Depends(get_annotation_service),
):
    try:
        item = annotations.update(annotation_id, req.body)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    return JSONResponse(asdict(item))


@router.delete("/annotations/{annotation_id}")
def delete_annotation(
    annotation_id: int,
    annotations: AnnotationService = Depends(get_annotation_service),
):
    try:
        annotations.delete(annotation_id)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    return {"ok": True}
