import io
import os
import re
import logging

import httpx
from pypdf import PdfReader

logger = logging.getLogger(__name__)

DEFAULT_HRMS_URL = os.getenv("HRMS_BACKEND_URL", "http://localhost:8000")


def extract_text_from_pdf(content: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(content))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        return text.strip()
    except Exception as e:
        logger.error(f"Failed to extract text from PDF: {e}")
        return ""


def extract_text_from_docx(content: bytes) -> str:
    try:
        from docx import Document
        doc = Document(io.BytesIO(content))
        text = "\n".join(para.text for para in doc.paragraphs)
        return text.strip()
    except ImportError:
        logger.warning("python-docx not installed, skipping DOCX parsing")
        return ""
    except Exception as e:
        logger.error(f"Failed to extract text from DOCX: {e}")
        return ""


async def get_resume_file_id(application_id: str, hrms_base_url: str) -> str:
    url = f"{hrms_base_url.rstrip('/')}/api/applications/{application_id}/resume-file-id"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()
        return data["fileId"]


async def download_resume(hrms_base_url: str, resume_file_id: str) -> bytes:
    url = f"{hrms_base_url.rstrip('/')}/api/applications/resume/{resume_file_id}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content


async def save_interview_summary(
    application_id: str,
    summary_data: dict,
    hrms_base_url: str,
) -> dict:
    url = f"{hrms_base_url.rstrip('/')}/api/applications/{application_id}/ai-interview-summary"
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(url, json=summary_data)
        resp.raise_for_status()
        return resp.json()


async def fetch_and_parse_resume(
    application_id: str,
    hrms_base_url: str = DEFAULT_HRMS_URL,
) -> str:
    try:
        file_id = await get_resume_file_id(application_id, hrms_base_url)
        logger.info(f"Resolved file ID: {file_id} for application: {application_id}")

        content = await download_resume(hrms_base_url, file_id)

        if not content:
            return "The resume file appears to be empty."

        text = extract_text_from_pdf(content)
        if not text:
            text = extract_text_from_docx(content)

        if not text:
            return "Could not extract text from the resume file. It may be a scanned image or an unsupported format."

        text = text[:10000]
        return text

    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return "Resume not found for this application in the recruitment system."
        return f"Error fetching resume: HTTP {e.response.status_code}"
    except httpx.RequestError as e:
        return f"Cannot connect to the recruitment system at {hrms_base_url}: {e}"
    except Exception as e:
        logger.error(f"Error parsing resume: {e}", exc_info=True)
        return f"Error processing resume: {str(e)}"
