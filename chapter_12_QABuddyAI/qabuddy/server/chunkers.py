"""Per-source chunkers.

One corpus, twelve source types. A 40-line Jenkins log and a PRD section should not be
chopped the same way, so `chunk_document` routes on `kind`:

    prose  -> heading-aware word windows
    code   -> symbol/block windows, so a function is never split in half
    log    -> fixed line windows, because logs have no paragraphs
    cases  -> one chunk per test-case row
    ticket -> one chunk per Jira field

Every chunk carries the metadata the UI needs to explain where it came from.
"""

from __future__ import annotations

import csv
import io
import json
import re

HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
# Lines that plausibly start a top-level code block.
CODE_START = re.compile(
    r"^(def |class |async def |function |export |async function |const \w+\s*=\s*\(|"
    r"@\w+|describe\(|it\(|test\(|public |private |protected |interface |type \w+ =)"
)
WORD = re.compile(r"\w+")


def _windows(words: list[str], size: int, overlap: int):
    """Yield (start, end, text) word windows. Overlap keeps boundary sentences whole."""
    step = max(size - overlap, 1)
    for start in range(0, max(len(words), 1), step):
        window = words[start : start + size]
        if not window:
            break
        yield start, start + len(window), " ".join(window)
        if start + size >= len(words):
            break


def _split_sections(text: str) -> list[tuple[str, str]]:
    """Split markdown into (heading, body) sections. Text before any heading is kept."""
    sections: list[tuple[str, str]] = []
    heading = ""
    buf: list[str] = []
    for line in text.splitlines():
        m = HEADING.match(line.strip())
        if m:
            if buf and "".join(buf).strip():
                sections.append((heading, "\n".join(buf).strip()))
            heading = m.group(2).strip()
            buf = []
        else:
            buf.append(line)
    if buf and "".join(buf).strip():
        sections.append((heading, "\n".join(buf).strip()))
    return sections or [("", text.strip())]


def chunk_prose(text: str, size: int, overlap: int) -> list[dict]:
    out = []
    for heading, body in _split_sections(text):
        words = body.split()
        if not words:
            continue
        for start, end, window in _windows(words, size, overlap):
            # Prefix the heading so a retrieved chunk is self-describing in the prompt.
            body_text = f"{heading}\n{window}" if heading else window
            out.append(
                {
                    "text": body_text,
                    "heading": heading,
                    "word_start": start,
                    "word_end": end,
                }
            )
    return out


def chunk_code(text: str, name: str, size: int, overlap: int) -> list[dict]:
    """Group code into top-level blocks; fall back to line windows if it has none."""
    lines = text.splitlines()
    blocks: list[list[str]] = []
    cur: list[str] = []
    for line in lines:
        if CODE_START.match(line) and cur:
            blocks.append(cur)
            cur = [line]
        else:
            cur.append(line)
    if cur:
        blocks.append(cur)

    out = []
    # If the heuristic found nothing meaningful, treat it as flat text.
    if len(blocks) < 2:
        words = text.split()
        for start, end, window in _windows(words, size * 2, overlap * 2):
            out.append({"text": f"{name}\n{window}", "heading": name, "word_start": start, "word_end": end})
        return out

    for block in blocks:
        body = "\n".join(block).strip()
        if not body:
            continue
        # A single oversized block (a long function) still gets windowed.
        if len(body.split()) > size * 3:
            for start, end, window in _windows(body.split(), size * 2, overlap * 2):
                out.append({"text": f"{name}\n{window}", "heading": name, "word_start": start, "word_end": end})
        else:
            out.append({"text": f"{name}\n{body}", "heading": name, "word_start": 0, "word_end": len(body.split())})
    return out


def chunk_log(text: str, name: str, lines_per_chunk: int) -> list[dict]:
    """Logs are line-oriented; window on lines, not words, and keep the line numbers."""
    lines = text.splitlines()
    step = max(lines_per_chunk - 5, 1)
    out = []
    for start in range(0, max(len(lines), 1), step):
        window = lines[start : start + lines_per_chunk]
        if not window:
            break
        out.append(
            {
                "text": f"{name} (lines {start + 1}-{start + len(window)})\n" + "\n".join(window),
                "heading": name,
                "word_start": start,
                "word_end": start + len(window),
            }
        )
        if start + lines_per_chunk >= len(lines):
            break
    return out


def chunk_cases(text: str, name: str) -> list[dict]:
    """One chunk per CSV row, rendered as `column: value` so it embeds like prose."""
    try:
        rows = list(csv.reader(io.StringIO(text)))
    except Exception:
        return chunk_prose(text, 120, 24)
    if len(rows) < 2:
        return chunk_prose(text, 120, 24)

    header = [h.strip() for h in rows[0]]
    out = []
    for i, row in enumerate(rows[1:], start=1):
        if not any(cell.strip() for cell in row):
            continue
        pairs = [f"{h}: {v.strip()}" for h, v in zip(header, row) if v.strip()]
        if not pairs:
            continue
        cid = row[0].strip() if row and row[0].strip() else f"row {i}"
        out.append(
            {
                "text": f"{name} / {cid}\n" + "\n".join(pairs),
                "heading": cid,
                "word_start": i,
                "word_end": i,
            }
        )
    return out


def chunk_ticket(text: str, name: str) -> list[dict]:
    """One chunk per Jira field, so 'acceptance criteria' is its own retrievable unit."""
    try:
        data = json.loads(text)
    except Exception:
        return chunk_prose(text, 120, 24)

    key = data.get("key") or data.get("id") or name
    out = []
    for field, value in data.items():
        if isinstance(value, (list, dict)):
            if isinstance(value, list) and value and isinstance(value[0], str):
                value = "\n- " + "\n- ".join(value)
            elif isinstance(value, list) and value and isinstance(value[0], dict):
                value = "\n".join(json.dumps(v, ensure_ascii=False) for v in value)
            else:
                value = json.dumps(value, ensure_ascii=False)
        if not value or not str(value).strip():
            continue
        heading = f"{key} · {field}"
        out.append(
            {
                "text": f"{heading}\n{value}".strip(),
                "heading": heading,
                "word_start": 0,
                "word_end": len(str(value).split()),
            }
        )
    return out or chunk_prose(text, 120, 24)


def chunk_document(text: str, kind: str, name: str, size: int = 150, overlap: int = 30) -> list[dict]:
    if kind == "code":
        return chunk_code(text, name, size, overlap)
    if kind == "log":
        return chunk_log(text, name, lines_per_chunk=40)
    if kind == "cases":
        return chunk_cases(text, name)
    if kind == "ticket":
        return chunk_ticket(text, name)
    return chunk_prose(text, size, overlap)
