# VMO-002: PDF Parser crashes on multi-page documents

**Status:** In Progress
**Priority:** Critical
**Component:** Backend / Document Ingestion
**Reported By:** Dev Team
**Date:** 2026-10-25

## Description
The `document_parser.py` script crashes with a `RecursionError` when processing PDF files larger than 50 pages. This blocks the ingestion pipeline for the new "Chapter 12" dataset.

## Steps to Reproduce
1. Run `python process_docs.py --file large_test_doc.pdf`
2. Wait for the parser to reach page 51.

## Traceback
```text
Traceback (most recent call last):
  File "document_parser.py", line 42, in parse_pdf
    return parse_page(page_num + 1)
  File "document_parser.py", line 42, in parse_pdf
    return parse_page(page_num + 1)
RecursionError: maximum recursion depth exceeded