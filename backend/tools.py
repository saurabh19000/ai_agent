"""
Tools for the interview agent.
Provides RAG search, feedback generation, and resume fetching capabilities.
"""

import os
import logging
from typing import Annotated, Optional
from livekit.agents import function_tool
from rag import query_rag
from resume_parser import (
    fetch_and_parse_resume,
    save_interview_summary as save_summary_to_hrms,
    DEFAULT_HRMS_URL,
)

logger = logging.getLogger(__name__)

_pending_summaries: dict[str, dict] = {}


def create_fetch_resume_tool(
    application_id: str,
    hrms_base_url: Optional[str] = None,
):
    """
    Create a fetch_resume function tool bound to a specific application.

    The tool resolves the resume file ID from the application, downloads
    and parses the resume, then returns the text content for the LLM.
    """
    base_url = hrms_base_url or os.getenv("HRMS_BACKEND_URL", DEFAULT_HRMS_URL)

    @function_tool
    async def fetch_resume() -> str:
        """
        Fetch the candidate's resume from the recruitment system.

        Call this after asking the initial predefined questions.
        The returned resume content will be used to ask personalized
        follow-up questions based on the candidate's actual experience.
        """
        logger.info(f"Fetching resume for application: {application_id} from {base_url}")
        text = await fetch_and_parse_resume(application_id, base_url)
        logger.info(f"Resume fetched: {len(text)} chars extracted")
        return text

    return fetch_resume


def create_save_summary_tool(
    application_id: str,
    department_slug: str,
    hrms_base_url: Optional[str] = None,
):
    """
    Create a save_interview_summary function tool bound to a specific application.

    The LLM calls this at the end of the interview. The summary is stored
    locally and flushed to the recruitment system when the session actually ends.
    """
    @function_tool
    async def save_interview_summary(
        rating: Annotated[int, "Overall rating from 1-10 for the interview performance"],
        strengths: Annotated[str, "What the candidate did well during the interview"],
        areas_for_improvement: Annotated[str, "Areas where the candidate could improve"],
    ) -> str:
        """
        Save the interview summary to the recruitment system.

        Call this after generating feedback to persist the interview results
        to the candidate's application record.
        """
        logger.info(f"Storing pending summary for application: {application_id}")

        _pending_summaries[application_id] = {
            "department": department_slug,
            "rating": rating,
            "strengths": strengths,
            "areas_for_improvement": areas_for_improvement,
        }

        return "Interview summary has been saved. It will be submitted when the interview ends."

    return save_interview_summary


@function_tool
async def search_project_docs(
    query: Annotated[
        str,
        "The search query to find relevant information from the project documentation",
    ]
) -> str:
    """
    Search the project documentation for relevant information.

    Use this tool to look up details about the user's project when you need
    to ask specific, informed questions during the technical interview.

    Args:
        query: What to search for in the documentation

    Returns:
        Relevant excerpts from the project documentation
    """
    try:
        logger.info(f"Searching project docs: {query}")

        context = query_rag(query, k=4, deduplicate=True)

        if not context or len(context.strip()) == 0:
            return f"No relevant information found for query: {query}"

        return f"Project Documentation Context:\n\n{context}"

    except Exception as e:
        logger.error(f"Error searching documentation: {str(e)}")
        return f"Error searching documentation: {str(e)}"


@function_tool
async def generate_feedback(
    strengths: Annotated[
        str,
        "What the candidate did well in their explanations",
    ],
    areas_for_improvement: Annotated[
        str,
        "Areas where the candidate could improve or provide more detail",
    ],
    rating: Annotated[
        int,
        "Overall rating from 1-10 for the technical interview performance",
    ]
) -> str:
    """
    Generate structured feedback for the candidate at the end of the interview.

    Use this tool to provide comprehensive feedback on the candidate's
    technical interview performance.

    Args:
        strengths: Positive aspects of the interview
        areas_for_improvement: Constructive feedback
        rating: Numeric rating (1-10)

    Returns:
        Formatted feedback summary
    """
    try:
        logger.info(f"Generating feedback: rating={rating}/10")

        if not (1 <= rating <= 10):
            rating = max(1, min(10, rating))

        feedback = f"""
Interview Feedback Summary
==========================

RATING: {rating}/10

STRENGTHS:
{strengths}

AREAS FOR IMPROVEMENT:
{areas_for_improvement}

Thank you for participating in this technical interview!
"""
        return feedback.strip()

    except Exception as e:
        logger.error(f"Error generating feedback: {str(e)}")
        return f"Error generating feedback: {str(e)}"


async def flush_pending_summary(
    application_id: str,
    hrms_base_url: Optional[str] = None,
):
    """Flush a pending interview summary to the HRMS system."""
    if application_id not in _pending_summaries:
        logger.info(f"No pending summary for application: {application_id}")
        return

    data = _pending_summaries.pop(application_id)
    base_url = hrms_base_url or os.getenv("HRMS_BACKEND_URL", DEFAULT_HRMS_URL)

    try:
        await save_summary_to_hrms(application_id, data, base_url)
        logger.info(f"Pending summary flushed for application: {application_id}")
    except Exception as e:
        logger.error(f"Failed to flush summary for {application_id}: {e}")
