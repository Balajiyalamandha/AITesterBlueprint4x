# Taste
- Prefers lightweight, free, open-source building blocks for AI/ML tooling (e.g. open-source embedding models like nomic-embed-text, open-source vector DBs like ChromaDB) over paid or heavyweight hosted alternatives, and wants them deployable locally (e.g. Docker/Ollama). Confidence: 0.8
- Wants recommendations grounded in up-to-date external research with cited sources rather than answers from model memory (e.g. explicitly asks the agent to "do the research and give me" a recommendation). Confidence: 0.6
- Wants demos/tools to be explainable — surface each internal pipeline stage in the UI (e.g. raw vs normalised text, how content is chunked, top-k retrieval results, server-side vector weights/scores) rather than presenting a black box. Confidence: 0.7
- Expects secrets/API keys to be supplied via a `.env` environment file rather than hardcoded. Confidence: 0.6
- Prefers the agent to go straight to implementation using decisions already finalized earlier (rather than pausing to re-confirm), and to actually launch/open the finished web app once the build is done. Confidence: 0.55
- Wants deliverables (e.g. project explanations) written as clear, self-contained markdown documents, phrased so they can be understood by and shared with non-technical stakeholders/managers. Confidence: 0.6
- Prefers automation over manual, repetitive steps in tools/workflows (e.g. dislikes having to add/index documents by hand every time and wants ingestion to happen automatically). Confidence: 0.5
