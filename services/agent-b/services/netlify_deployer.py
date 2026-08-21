from __future__ import annotations

import logging
import os
import shutil
import subprocess
import zipfile
from io import BytesIO
from pathlib import Path

import httpx

logger = logging.getLogger("agent-b.deploy")

NETLIFY_API = "https://api.netlify.com/api/v1"


def _npm_cmd() -> str:
    if os.name == "nt":
        return "npm.cmd"
    return "npm"


def _netlify_token() -> str:
    return (
        (os.getenv("NETLIFY_AUTH_TOKEN") or os.getenv("NETLIFY_TOKEN") or "")
        .strip()
    )


def build_vite_project(project_path: Path, timeout_seconds: int = 300) -> Path:
    """Run npm install + npm run build; return the dist/ directory."""
    project_path = project_path.resolve()
    npm = _npm_cmd()
    if shutil.which(npm) is None and shutil.which("npm") is None:
        raise RuntimeError(
            "Node.js/npm is required to build the invitation site before Netlify deploy."
        )

    env = {**os.environ, "CI": "true"}
    logger.info("npm install in %s", project_path)
    subprocess.run(
        [npm, "install", "--no-fund", "--no-audit"],
        cwd=project_path,
        check=True,
        timeout=timeout_seconds,
        env=env,
        capture_output=True,
        text=True,
    )
    logger.info("npm run build in %s", project_path)
    subprocess.run(
        [npm, "run", "build"],
        cwd=project_path,
        check=True,
        timeout=timeout_seconds,
        env=env,
        capture_output=True,
        text=True,
    )
    dist = project_path / "dist"
    if not dist.is_dir() or not any(dist.iterdir()):
        raise RuntimeError(f"Build produced no dist/ output in {project_path}")
    return dist


def _zip_dist(dist_dir: Path) -> bytes:
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in dist_dir.rglob("*"):
            if path.is_file():
                archive.write(path, path.relative_to(dist_dir).as_posix())
    return buf.getvalue()


def _safe_site_name(raw: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in raw)
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    cleaned = cleaned.strip("-")[:40] or "gatherly-invite"
    return cleaned


def deploy_dist_to_netlify(
    dist_dir: Path,
    *,
    site_name: str | None = None,
) -> dict:
    """
    Create a Netlify site (if needed) and deploy dist/ as a ZIP.
    Requires NETLIFY_AUTH_TOKEN. Optional NETLIFY_SITE_ID reuses an existing site.
    """
    token = _netlify_token()
    if not token:
        raise RuntimeError(
            "NETLIFY_AUTH_TOKEN (or NETLIFY_TOKEN) is not set. Create a Netlify "
            "personal access token and add it to the root .env."
        )

    zip_bytes = _zip_dist(dist_dir)
    auth = {"Authorization": f"Bearer {token}"}
    existing_site_id = (os.getenv("NETLIFY_SITE_ID") or "").strip() or None

    with httpx.Client(timeout=180.0) as client:
        if existing_site_id:
            site_id = existing_site_id
            site_url = None
        else:
            payload: dict = {"created_via": "gatherly-agent-b"}
            if site_name:
                payload["name"] = _safe_site_name(site_name)
            site_resp = client.post(
                f"{NETLIFY_API}/sites",
                headers={**auth, "Content-Type": "application/json"},
                json=payload,
            )
            if site_resp.status_code >= 400:
                # Name collision → retry without name so Netlify assigns one.
                if site_name and site_resp.status_code in {422, 400}:
                    site_resp = client.post(
                        f"{NETLIFY_API}/sites",
                        headers={**auth, "Content-Type": "application/json"},
                        json={"created_via": "gatherly-agent-b"},
                    )
            site_resp.raise_for_status()
            site = site_resp.json()
            site_id = site["id"]
            site_url = site.get("ssl_url") or site.get("url")

        deploy_resp = client.post(
            f"{NETLIFY_API}/sites/{site_id}/deploys",
            headers={**auth, "Content-Type": "application/zip"},
            content=zip_bytes,
        )
        deploy_resp.raise_for_status()
        deploy = deploy_resp.json()

    deploy_url = (
        deploy.get("ssl_url")
        or deploy.get("url")
        or site_url
        or f"https://{site_id}.netlify.app"
    )
    return {
        "status": "success",
        "site_id": site_id,
        "deploy_id": deploy.get("id"),
        "deploy_url": deploy_url,
        "state": deploy.get("state"),
    }


def build_and_deploy(project_path: Path, *, site_name: str | None = None) -> dict:
    dist = build_vite_project(project_path)
    return deploy_dist_to_netlify(dist, site_name=site_name)
