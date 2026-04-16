"""FastAPI dependency functions for DI."""

from fastapi import Request

from seminar.config import Config
from seminar.server.broadcast import BroadcastHub
from seminar.service.ideas import IdeaService
from seminar.service.proposals import ProposalService
from seminar.service.runs import RunService
from seminar.service.search import SearchService
from seminar.service.studies import StudyService
from seminar.workers import WorkerPool


def get_hub(request: Request) -> BroadcastHub:
    return request.app.state.hub


def get_idea_service(request: Request) -> IdeaService:
    return request.app.state.idea_service


def get_study_service(request: Request) -> StudyService:
    return request.app.state.study_service


def get_proposal_service(request: Request) -> ProposalService:
    return request.app.state.proposal_service


def get_search_service(request: Request) -> SearchService:
    return request.app.state.search_service


def get_run_service(request: Request) -> RunService:
    return request.app.state.run_service


def get_pool(request: Request) -> WorkerPool:
    return request.app.state.pool


def get_cfg(request: Request) -> Config:
    return request.app.state.cfg
