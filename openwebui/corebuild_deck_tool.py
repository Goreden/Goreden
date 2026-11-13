"""
title: CoreBuild Deck Builder
author: CoreBuild
description: Builds CoreBuild-branded Arabic PowerPoint proposals (and PDF copies). Financial proposals come straight from an uploaded BOQ Excel file; other decks from a JSON slide spec.
version: 1.0.0
requirements: requests
"""

import asyncio
import json
import os
from typing import Any, Awaitable, Callable, Optional

import requests
from pydantic import BaseModel, Field


class Tools:
    class Valves(BaseModel):
        DECK_BUILDER_URL: str = Field(
            default="http://deck-builder:8000",
            description="Address Open WebUI uses to reach the deck-builder container",
        )
        API_KEY: str = Field(default="", description="Same value as API_KEY in the deck-builder .env")
        TIMEOUT: int = Field(default=300, description="Seconds to wait for a build (PDF conversion is the slow part)")

    def __init__(self):
        self.valves = self.Valves()

    # ---------- helpers ----------
    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.valves.API_KEY}"} if self.valves.API_KEY else {}

    async def _status(self, emitter, text: str, done: bool = False):
        if emitter:
            await emitter({"type": "status", "data": {"description": text, "done": done}})

    async def _show_links(self, emitter, title: str, data: dict):
        if not emitter:
            return
        lines = [f"**{title}**", f"- [تحميل PowerPoint]({data['pptx_url']})"]
        if data.get("pdf_url"):
            lines.append(f"- [تحميل PDF]({data['pdf_url']})")
        await emitter({"type": "message", "data": {"content": "\n".join(lines) + "\n\n"}})

    @staticmethod
    def _file_bytes(entry: dict) -> tuple[Optional[str], Optional[bytes]]:
        """Return (name, bytes) for one item of __files__, across Open WebUI versions."""
        f = entry.get("file") or entry
        name = f.get("filename") or entry.get("name") or f.get("meta", {}).get("name") or ""
        path = f.get("path")
        file_id = f.get("id") or entry.get("id")
        if not path and file_id:
            try:
                from open_webui.models.files import Files

                rec = Files.get_file_by_id(file_id)
                path = rec.path if rec else None
                name = name or (rec.filename if rec else "")
            except Exception:
                path = None
        if path:
            try:
                from open_webui.storage.provider import Storage

                path = Storage.get_file(path)  # downloads from S3/GCS if needed; returns a local path
            except Exception:
                pass
            if os.path.exists(path):
                with open(path, "rb") as fh:
                    return name, fh.read()
        return name, None

    # ---------- tools ----------
    async def build_financial_proposal(
        self,
        project: str = "مشروع إنشاء عمارة سكنية",
        client: str = "",
        meta: str = "",
        vat_rate: float = 15,
        prices_include_vat: bool = False,
        __files__: Optional[list] = None,
        __event_emitter__: Optional[Callable[[Any], Awaitable[None]]] = None,
    ) -> str:
        """
        Build the CoreBuild financial proposal deck from the BOQ Excel file the user uploaded in this chat.
        All numbers are read from the spreadsheet; never type prices yourself.
        :param project: Project name in Arabic, e.g. "مشروع إنشاء عمارة سكنية — حي مشرفة، جدة".
        :param client: Who the proposal is submitted to, e.g. "لجنة فحص العروض — وقف الإخلاص". Empty if unknown.
        :param meta: Optional short line for the cover (plot number, building description).
        :param vat_rate: VAT percentage, 15 in Saudi Arabia.
        :param prices_include_vat: true only if the user said the BOQ prices already include VAT.
        :return: JSON with totals, links and warnings.
        """
        xlsx = [f for f in (__files__ or []) if str(self._file_bytes_name(f)).lower().endswith((".xlsx", ".xlsm"))]
        if not xlsx:
            return "No Excel (.xlsx) file is attached to this chat. Ask the user to upload the BOQ spreadsheet."
        name, blob = self._file_bytes(xlsx[-1])
        if not blob:
            return f"Could not read the uploaded file {name!r} from Open WebUI storage."
        await self._status(__event_emitter__, "جارٍ قراءة جدول الكميات وبناء العرض المالي…")
        options = {"project": project, "client": client, "vat_rate": vat_rate, "prices_include_vat": prices_include_vat, "file_name": "CoreBuild_Financial_Proposal"}
        if meta:
            options["meta"] = meta

        def call():
            return requests.post(
                f"{self.valves.DECK_BUILDER_URL}/financial",
                headers=self._headers(),
                files={"file": (name or "boq.xlsx", blob)},
                data={"options": json.dumps(options, ensure_ascii=False)},
                timeout=self.valves.TIMEOUT,
            )

        try:
            r = await asyncio.to_thread(call)
            data = r.json()
        except Exception as e:
            await self._status(__event_emitter__, "تعذر الاتصال بخدمة بناء العروض", True)
            return f"deck-builder request failed: {e}"
        if r.status_code != 200:
            await self._status(__event_emitter__, "فشل بناء العرض", True)
            return f"deck-builder error: {data.get('error', r.text)}"
        await self._status(__event_emitter__, "تم بناء العرض المالي", True)
        await self._show_links(__event_emitter__, "العرض المالي جاهز", data)
        return json.dumps(data, ensure_ascii=False)

    @staticmethod
    def _file_bytes_name(entry: dict) -> str:
        f = entry.get("file") or entry
        return f.get("filename") or entry.get("name") or f.get("meta", {}).get("name") or ""

    async def get_deck_guide(self) -> str:
        """
        Get the slide types, JSON fields and writing rules for build_deck. Call this before your first build_deck call.
        :return: Markdown guide.
        """
        try:
            r = await asyncio.to_thread(lambda: requests.get(f"{self.valves.DECK_BUILDER_URL}/guide", timeout=30))
            return r.text
        except Exception as e:
            return f"deck-builder request failed: {e}"

    async def build_deck(
        self,
        spec_json: str,
        __event_emitter__: Optional[Callable[[Any], Awaitable[None]]] = None,
    ) -> str:
        """
        Build a CoreBuild-branded deck (technical proposal, company profile, any presentation) from a JSON spec.
        The spec format is described by get_deck_guide. If the result has warnings about text that does not fit,
        shorten exactly that text and call build_deck again (at most 3 times).
        :param spec_json: The full deck spec as a JSON string: {"title", "footer", "tagline", "sections": [{"title", "slides": [...]}]}.
        :return: JSON with slide count, links and warnings.
        """
        try:
            spec = json.loads(spec_json) if isinstance(spec_json, str) else spec_json
        except json.JSONDecodeError as e:
            return f"spec_json is not valid JSON: {e}. Fix the JSON and call build_deck again."
        await self._status(__event_emitter__, "جارٍ بناء العرض…")

        def call():
            return requests.post(f"{self.valves.DECK_BUILDER_URL}/decks", headers=self._headers(), json=spec, timeout=self.valves.TIMEOUT)

        try:
            r = await asyncio.to_thread(call)
            data = r.json()
        except Exception as e:
            await self._status(__event_emitter__, "تعذر الاتصال بخدمة بناء العروض", True)
            return f"deck-builder request failed: {e}"
        if r.status_code != 200:
            await self._status(__event_emitter__, "فشل بناء العرض", True)
            return f"deck-builder rejected the spec: {data.get('error', r.text)}. Fix it and call build_deck again."
        warnings = data.get("warnings") or []
        await self._status(__event_emitter__, f"تم بناء {data.get('slides')} شريحة" + (f" — {len(warnings)} ملاحظة" if warnings else ""), True)
        if not warnings:
            await self._show_links(__event_emitter__, "العرض جاهز", data)
        return json.dumps(data, ensure_ascii=False)
