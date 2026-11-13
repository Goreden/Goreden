"""
title: CoreBuild Deck Builder
author: CoreBuild
description: Builds and edits CoreBuild-branded Arabic PowerPoint proposals (with PDF copies). Existing decks are imported and edited slide by slide; every build is checked by the server (facts and text fit). Financial proposals and BOQ answers come straight from the uploaded Excel file.
version: 2.0.0
requirements: requests
"""

import asyncio
import base64
import json
import os
import re
from typing import Any, Awaitable, Callable, Optional

import requests
from pydantic import BaseModel, Field

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif")


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

    async def _say(self, emitter, text: str):
        """Post text straight into the chat (the model cannot change it)."""
        if emitter and text:
            await emitter({"type": "message", "data": {"content": text.strip() + "\n\n"}})

    @staticmethod
    def _links(data: dict, title: str) -> str:
        lines = [f"**{title}**"]
        if data.get("pptx_url"):
            lines.append(f"- [تحميل PowerPoint]({data['pptx_url']})")
        if data.get("pdf_url"):
            lines.append(f"- [تحميل PDF]({data['pdf_url']})")
        if data.get("xlsx_url"):
            lines.append(f"- [تحميل جدول الكميات المسعّر (Excel)]({data['xlsx_url']})")
        return "\n".join(lines)

    @staticmethod
    def _entry_name(entry: dict) -> str:
        f = entry.get("file") or entry
        return f.get("filename") or entry.get("name") or (f.get("meta") or {}).get("name") or ""

    @staticmethod
    def _entry_type(entry: dict) -> str:
        f = entry.get("file") or entry
        return (f.get("meta") or {}).get("content_type") or entry.get("content_type") or ""

    @staticmethod
    def _read_file_id(file_id: str) -> tuple[str, Optional[bytes]]:
        try:
            from open_webui.models.files import Files
            from open_webui.storage.provider import Storage

            rec = Files.get_file_by_id(file_id)
            if rec and rec.path:
                p = Storage.get_file(rec.path)
                if os.path.exists(p):
                    with open(p, "rb") as fh:
                        return rec.filename or "", fh.read()
        except Exception:
            pass
        return "", None

    def _file_bytes(self, entry: dict) -> tuple[str, Optional[bytes]]:
        """Return (name, bytes) for one item of __files__, across Open WebUI versions."""
        f = entry.get("file") or entry
        name = self._entry_name(entry)
        path = f.get("path")
        if path:
            try:
                from open_webui.storage.provider import Storage

                path = Storage.get_file(path)
            except Exception:
                pass
            if os.path.exists(path):
                with open(path, "rb") as fh:
                    return name, fh.read()
        file_id = f.get("id") or entry.get("id")
        if file_id:
            n, blob = self._read_file_id(file_id)
            return name or n, blob
        return name, None

    def _latest(self, files, exts) -> Optional[dict]:
        hits = [f for f in (files or []) if self._entry_name(f).lower().endswith(exts)]
        return hits[-1] if hits else None

    def _call(self, method: str, path: str, **kw):
        r = requests.request(method, f"{self.valves.DECK_BUILDER_URL}{path}", headers=self._headers(), timeout=self.valves.TIMEOUT, **kw)
        try:
            data = r.json()
        except Exception:
            data = {"error": r.text[:500]}
        return r.status_code, data

    async def _post_file(self, path: str, name: str, blob: bytes, options: Optional[dict] = None):
        data = {"options": json.dumps(options, ensure_ascii=False)} if options else None
        return await asyncio.to_thread(self._call, "POST", path, files={"file": (name, blob)}, data=data)

    # ---------- financial / Excel ----------
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
        Build the CoreBuild financial proposal deck (and a priced BOQ Excel with formulas) from the BOQ Excel file uploaded in this chat.
        All numbers are read and calculated by code from the spreadsheet; never type prices yourself.
        :param project: Project name in Arabic, e.g. "مشروع إنشاء عمارة سكنية — حي مشرفة، جدة".
        :param client: Who the proposal is submitted to, e.g. "لجنة فحص العروض — وقف الإخلاص". Empty if unknown.
        :param meta: Optional short line for the cover (plot number, building description).
        :param vat_rate: VAT percentage, 15 in Saudi Arabia.
        :param prices_include_vat: true only if the user said the BOQ prices already include VAT.
        :return: JSON with totals, links and warnings.
        """
        entry = self._latest(__files__, (".xlsx", ".xlsm"))
        if not entry:
            return "No Excel (.xlsx) file is attached to this chat. Ask the user to upload the BOQ spreadsheet."
        name, blob = self._file_bytes(entry)
        if not blob:
            return f"Could not read the uploaded file {name!r} from Open WebUI storage. Ask the user to upload it again."
        await self._status(__event_emitter__, "جارٍ قراءة جدول الكميات وبناء العرض المالي…")
        options = {"project": project, "client": client, "vat_rate": vat_rate, "prices_include_vat": prices_include_vat, "file_name": "CoreBuild_Financial_Proposal"}
        if meta:
            options["meta"] = meta
        try:
            code, data = await self._post_file("/financial", name or "boq.xlsx", blob, options)
        except Exception as e:
            await self._status(__event_emitter__, "تعذر الاتصال بخدمة بناء العروض", True)
            return f"deck-builder request failed: {e}"
        if code != 200:
            await self._status(__event_emitter__, "تعذر قراءة الجدول", True)
            return f"deck-builder could not read the BOQ: {data.get('error')}. Tell the user exactly this problem; do not guess numbers."
        s = data.get("summary") or {}
        await self._status(__event_emitter__, "تم بناء العرض المالي", True)
        fmt = lambda v: f"{v:,.2f}"
        report = [self._links(data, "العرض المالي جاهز"), "", "**الإجماليات (محسوبة آليًا من ملف Excel):**",
                  f"- الإجمالي قبل الضريبة: {fmt(s.get('net', 0))} ريال",
                  f"- ضريبة القيمة المضافة {s.get('vat_rate')}%: {fmt(s.get('vat', 0))} ريال",
                  f"- الإجمالي شامل الضريبة: {fmt(s.get('gross', 0))} ريال"]
        if data.get("warnings"):
            report += ["", "**⚠️ ملاحظات على الجدول (راجعها قبل الإرسال):**"] + [f"- {w}" for w in data["warnings"][:25]]
        await self._say(__event_emitter__, "\n".join(report))
        return json.dumps(data, ensure_ascii=False)

    async def read_boq(
        self,
        search: str = "",
        __files__: Optional[list] = None,
        __event_emitter__: Optional[Callable[[Any], Awaitable[None]]] = None,
    ) -> str:
        """
        Read the BOQ Excel file uploaded in this chat and answer questions about it with numbers calculated by code:
        totals per sheet and section, problems found in the file, and (with `search`) the matching items with their summed quantity and amount.
        Use this for any question about the spreadsheet's numbers. Quote the results; never add up or recalculate numbers yourself.
        :param search: Optional words to filter items, e.g. "خرسانة" or "بلاط". Several alternatives separated by | (e.g. "حديد|تسليح").
        :return: JSON with totals, problems and matching items.
        """
        entry = self._latest(__files__, (".xlsx", ".xlsm"))
        if not entry:
            return "No Excel (.xlsx) file is attached to this chat."
        name, blob = self._file_bytes(entry)
        if not blob:
            return f"Could not read {name!r}. Ask the user to upload it again."
        await self._status(__event_emitter__, "جارٍ قراءة جدول الكميات…")
        code, data = await self._post_file("/boq/read", name or "boq.xlsx", blob)
        await self._status(__event_emitter__, "تمت قراءة الجدول", True)
        if code != 200:
            return f"The spreadsheet could not be read: {data.get('error')}. Tell the user exactly this; do not guess."
        out = {"file": name, "stats": data.get("stats"), "problems": data.get("problems"), "parts": []}
        for p in data.get("parts", []):
            out["parts"].append({"sheet": p["sheet"], "title": p["title"], "total": p["total"],
                                 "sections": [{"title": s["title"], "items": len(s["items"]), "total": s["total"]} for s in p["sections"]]})
        if search.strip():
            pats = [re.escape(w.strip()) for w in search.split("|") if w.strip()]
            rx = re.compile("|".join(pats))
            hits = [dict(it, sheet=p["sheet"], section=s["title"]) for p in data.get("parts", []) for s in p["sections"] for it in s["items"] if rx.search(it.get("desc", ""))]
            by_unit = {}
            for it in hits:
                u = by_unit.setdefault(it.get("unit") or "-", {"qty": 0.0, "amount": 0.0, "items": 0})
                u["qty"] = round(u["qty"] + it["qty"], 3)
                u["amount"] = round(u["amount"] + it["amount"], 2)
                u["items"] += 1
            out["search"] = {"query": search, "matches": len(hits), "total_amount": round(sum(i["amount"] for i in hits), 2), "by_unit": by_unit, "items": hits[:60]}
        return json.dumps(out, ensure_ascii=False)

    # ---------- existing decks ----------
    async def import_deck(
        self,
        __files__: Optional[list] = None,
        __event_emitter__: Optional[Callable[[Any], Awaitable[None]]] = None,
    ) -> str:
        """
        Import the PowerPoint (.pptx) uploaded in this chat into an editable deck. ALWAYS call this first when the user uploads a deck
        to fix, re-format, redesign or change. Every slide, fact and number is carried over by code (nothing is re-typed),
        rebuilt in CoreBuild design, and checked. Returns deck_id and an outline (slide number, type, title).
        Then change only what the user asked for with edit_deck. Never rebuild an uploaded deck from its text with build_deck.
        :return: JSON with deck_id, outline, links and the server's check report.
        """
        entry = self._latest(__files__, (".pptx",))
        if not entry:
            return "No PowerPoint (.pptx) file is attached to this chat. Ask the user to upload it (old .ppt files must be saved as .pptx first)."
        name, blob = self._file_bytes(entry)
        if not blob:
            return f"Could not read the uploaded file {name!r}. Ask the user to upload it again."
        await self._status(__event_emitter__, "جارٍ استيراد العرض وتحويل كل شريحة…")
        try:
            code, data = await self._post_file("/import", name or "deck.pptx", blob)
        except Exception as e:
            await self._status(__event_emitter__, "تعذر الاتصال بخدمة بناء العروض", True)
            return f"deck-builder request failed: {e}"
        if code != 200:
            await self._status(__event_emitter__, "تعذر استيراد الملف", True)
            return f"The deck could not be imported: {data.get('error')}. Tell the user exactly this and stop."
        await self._status(__event_emitter__, f"تم استيراد العرض ({data.get('slides')} شريحة)", True)
        msg = [self._links(data, "نسخة أولى بتصميم CoreBuild (كل المحتوى منقول آليًا)")]
        if data.get("kept_as_picture"):
            msg.append("- شرائح بقيت كصورة من الأصل لأن تحويلها كان سيُفقد شيئًا: " + "، ".join(str(p["source"]) for p in data["kept_as_picture"]))
        if data.get("check_report"):
            msg.append(data["check_report"])
        await self._say(__event_emitter__, "\n\n".join(msg))
        keep = {k: data.get(k) for k in ("deck_id", "mode", "slides", "source_slides", "kept_as_picture", "warnings", "outline")}
        keep["next"] = "Call get_slides for the slides you need to change, then edit_deck with only those changes."
        return json.dumps(keep, ensure_ascii=False)

    async def get_slides(self, deck_id: str, slides: str) -> str:
        """
        Get the full JSON of chosen slides of a deck (to see their content before editing them).
        :param deck_id: The deck_id from import_deck, edit_deck or build_deck.
        :param slides: Slide numbers, e.g. "7,8" or "12-15", or "all".
        :return: JSON with the slides (each with its number n).
        """
        code, data = await asyncio.to_thread(self._call, "GET", f"/decks/{deck_id}", params={"slides": slides})
        if code != 200:
            return f"error: {data.get('error')}"
        return json.dumps(data, ensure_ascii=False)

    async def edit_deck(
        self,
        deck_id: str,
        edits_json: str,
        __event_emitter__: Optional[Callable[[Any], Awaitable[None]]] = None,
    ) -> str:
        """
        Change specific slides of an existing deck; every other slide stays exactly as it is. The server applies the edits,
        re-checks every number and line against the previous version, fixes text that does not fit by splitting slides,
        and posts its change list and check report in the chat.
        Edits (slide numbers refer to the deck before this call):
        {"op":"replace","slide":7,"rewrite":true,"with":{slide JSON}}  (or "with":[two slides] to turn one slide into two)
        {"op":"update","slide":7,"set":{"title":"...","cards.0.items.2":"..."}}
        {"op":"insert_after","slide":7,"slides":[{slide JSON}]}   (0 = at the start)
        {"op":"move","slide":9,"after":3}
        {"op":"delete","slide":9}   (only when the user asked to remove it)
        Set "rewrite": true on slides the user asked you to rephrase, so the report treats the new wording as intended.
        :param deck_id: The current deck_id (each edit returns a new deck_id; always use the latest).
        :param edits_json: JSON array of edits.
        :return: JSON with the new deck_id, links, change list and check report.
        """
        try:
            edits = json.loads(edits_json) if isinstance(edits_json, str) else edits_json
            if isinstance(edits, dict):
                edits = edits.get("edits", [edits])
        except json.JSONDecodeError as e:
            return f"edits_json is not valid JSON: {e}. Fix it and call edit_deck again."
        await self._status(__event_emitter__, "جارٍ تطبيق التعديلات والتحقق منها…")
        try:
            code, data = await asyncio.to_thread(self._call, "POST", f"/decks/{deck_id}/edit", json={"edits": edits})
        except Exception as e:
            await self._status(__event_emitter__, "تعذر الاتصال بخدمة بناء العروض", True)
            return f"deck-builder request failed: {e}"
        if code != 200:
            await self._status(__event_emitter__, "لم تُطبق التعديلات", True)
            return f"The edits were rejected: {data.get('error')}. Fix exactly that and call edit_deck again."
        await self._status(__event_emitter__, f"تم — {data.get('slides')} شريحة", True)
        await self._say(__event_emitter__, "\n\n".join(x for x in [self._links(data, "العرض بعد التعديل"), data.get("change_report"), data.get("check_report")] if x))
        keep = {k: data.get(k) for k in ("deck_id", "slides", "changes", "warnings", "auto_fixes", "check", "outline")}
        return json.dumps(keep, ensure_ascii=False)

    # ---------- photos ----------
    async def list_chat_photos(
        self,
        __files__: Optional[list] = None,
        __messages__: Optional[list] = None,
        __event_emitter__: Optional[Callable[[Any], Awaitable[None]]] = None,
    ) -> str:
        """
        Get the photos the user attached in this chat, as references to put in slides: hero "panel": {"image": "media:..."}
        or a "picture" slide {"type":"picture","image":"media:...","caption":"..."}. Call this before using any photo.
        :return: JSON list of photos (name, ref, width, height), in the order they were attached.
        """
        found, seen = [], set()

        def add(name, blob):
            if blob and len(blob) > 100:
                key = hash(blob[:2048]) ^ len(blob)
                if key not in seen:
                    seen.add(key)
                    found.append((name or f"photo_{len(found) + 1}", blob))

        for entry in __files__ or []:
            if self._entry_name(entry).lower().endswith(IMAGE_EXT) or self._entry_type(entry).startswith("image/") or entry.get("type") == "image":
                url = entry.get("url") or ""
                if url.startswith("data:image"):
                    add(self._entry_name(entry), base64.b64decode(url.split(",", 1)[1]))
                else:
                    add(*self._file_bytes(entry))
        for m in __messages__ or []:
            content = m.get("content")
            parts = content if isinstance(content, list) else []
            for p in parts:
                if p.get("type") == "image_url":
                    url = (p.get("image_url") or {}).get("url", "")
                    if url.startswith("data:image"):
                        add("", base64.b64decode(url.split(",", 1)[1]))
                    else:
                        mm = re.search(r"/files/([0-9a-f-]{36})", url)
                        if mm:
                            add(*self._read_file_id(mm.group(1)))
            for f in m.get("files") or []:
                if f.get("type") == "image" or str(f.get("url", "")).startswith("data:image"):
                    url = f.get("url", "")
                    if url.startswith("data:image"):
                        add(f.get("name", ""), base64.b64decode(url.split(",", 1)[1]))
                    else:
                        mm = re.search(r"/files/([0-9a-f-]{36})", url)
                        if mm:
                            add(*self._read_file_id(mm.group(1)))
        # photos noted by the CoreBuild photo filter
        refs = []
        for m in __messages__ or []:
            text = m.get("content") if isinstance(m.get("content"), str) else ""
            refs += re.findall(r"media:[0-9a-f]{20}\.(?:png|jpg|webp|gif)", text or "")
        if not found and not refs:
            return "No photos are attached in this chat. Ask the user to attach the photos (JPG or PNG)."
        out = []
        for name, blob in found:
            code, data = await asyncio.to_thread(self._call, "POST", "/media", files={"file": (name or "photo.jpg", blob)})
            if code == 200:
                out.append({"name": name, "ref": data["ref"], "width": data.get("width"), "height": data.get("height")})
        for r in refs:
            if not any(o["ref"] == r for o in out):
                out.append({"name": "", "ref": r})
        return json.dumps({"photos": out, "use": 'Put a ref in a slide, e.g. "panel": {"image": "media:..."} on a hero slide.'}, ensure_ascii=False)

    # ---------- new decks ----------
    async def get_deck_guide(self) -> str:
        """
        Get the slide types, JSON fields, edit operations and writing rules. Call this once per chat before your first build_deck or edit_deck.
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
        Build a NEW CoreBuild-branded deck (technical proposal, company profile, presentation) from a full JSON spec.
        Not for decks the user uploaded: use import_deck + edit_deck for those. Text that does not fit is split onto
        continuation slides by the server; remaining problems come back in `warnings`.
        :param spec_json: The full deck spec as a JSON string: {"title", "footer", "tagline", "sections": [{"title", "slides": [...]}]}.
        :return: JSON with deck_id, slide count, links and warnings.
        """
        try:
            spec = json.loads(spec_json) if isinstance(spec_json, str) else spec_json
        except json.JSONDecodeError as e:
            return f"spec_json is not valid JSON: {e}. Fix the JSON and call build_deck again."
        await self._status(__event_emitter__, "جارٍ بناء العرض…")
        try:
            code, data = await asyncio.to_thread(self._call, "POST", "/decks", json=spec)
        except Exception as e:
            await self._status(__event_emitter__, "تعذر الاتصال بخدمة بناء العروض", True)
            return f"deck-builder request failed: {e}"
        if code != 200:
            await self._status(__event_emitter__, "فشل بناء العرض", True)
            return f"deck-builder rejected the spec: {data.get('error')}. Fix it and call build_deck again."
        warnings = data.get("warnings") or []
        await self._status(__event_emitter__, f"تم بناء {data.get('slides')} شريحة" + (f" — {len(warnings)} ملاحظة" if warnings else ""), True)
        await self._say(__event_emitter__, "\n\n".join(x for x in [self._links(data, "العرض جاهز"), data.get("check_report")] if x))
        keep = {k: data.get(k) for k in ("deck_id", "slides", "warnings", "auto_fixes", "outline")}
        return json.dumps(keep, ensure_ascii=False)
