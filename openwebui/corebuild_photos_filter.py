"""
title: CoreBuild Photos
author: CoreBuild
description: Lets workers attach photos to CoreBuild Proposals. Each attached image is stored in the deck builder and replaced in the message by a media: reference the model can put on a slide, so text-only models never receive raw images.
version: 1.0.0
requirements: requests
"""

import base64
import hashlib
import os
import re
from typing import Optional

import requests
from pydantic import BaseModel, Field


class Filter:
    class Valves(BaseModel):
        DECK_BUILDER_URL: str = Field(default="http://deck-builder:8000", description="Address of the deck-builder container")
        API_KEY: str = Field(default="", description="Same value as API_KEY in the deck-builder .env")
        priority: int = Field(default=0, description="Filter order")

    def __init__(self):
        self.valves = self.Valves()
        self._refs: dict[str, str] = {}  # sha1 of image → media ref

    def _bytes(self, url: str) -> Optional[bytes]:
        if url.startswith("data:image"):
            return base64.b64decode(url.split(",", 1)[1])
        m = re.search(r"/files/([0-9a-f-]{36})", url)
        if not m:
            return None
        try:
            from open_webui.models.files import Files
            from open_webui.storage.provider import Storage

            rec = Files.get_file_by_id(m.group(1))
            if rec and rec.path:
                p = Storage.get_file(rec.path)
                if os.path.exists(p):
                    with open(p, "rb") as fh:
                        return fh.read()
        except Exception:
            return None
        return None

    def _ref(self, blob: bytes) -> Optional[str]:
        key = hashlib.sha1(blob).hexdigest()
        if key in self._refs:
            return self._refs[key]
        try:
            headers = {"Authorization": f"Bearer {self.valves.API_KEY}"} if self.valves.API_KEY else {}
            r = requests.post(f"{self.valves.DECK_BUILDER_URL}/media", headers=headers, files={"file": ("photo", blob)}, timeout=60)
            if r.status_code == 200:
                self._refs[key] = r.json()["ref"]
                return self._refs[key]
        except Exception:
            pass
        return None

    def inlet(self, body: dict, __user__: Optional[dict] = None) -> dict:
        count = 0
        for msg in body.get("messages", []):
            content = msg.get("content")
            if not isinstance(content, list):
                continue
            texts, notes = [], []
            for part in content:
                kind = part.get("type") if isinstance(part, dict) else None
                if kind in ("image_url", "input_image"):
                    data = part.get("image_url")
                    url = data.get("url", "") if isinstance(data, dict) else str(data or "")
                    blob = self._bytes(url)
                    ref = self._ref(blob) if blob else None
                    count += 1
                    notes.append(f"[صورة مرفقة {count}: {ref}]" if ref else f"[صورة مرفقة {count}: تعذر حفظها — اطلب من المستخدم إرفاقها مرة أخرى]")
                elif kind == "text":
                    texts.append(part.get("text", ""))
                elif isinstance(part, str):
                    texts.append(part)
            if notes:
                msg["content"] = ("\n".join(t for t in texts if t) + "\n\n" + "\n".join(notes)).strip()
        return body
