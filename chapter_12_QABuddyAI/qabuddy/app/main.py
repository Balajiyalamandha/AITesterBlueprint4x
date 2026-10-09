from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(
    title="QABuddy AI",
    description="AI-powered assistant for testers",
    version="0.1.0",
)

# Allow a browser front-end (e.g. React/Streamlit) to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten this in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TestCaseRequest(BaseModel):
    requirement: str
    count: int = 5


class TestCaseResponse(BaseModel):
    requirement: str
    test_cases: list[str]


@app.get("/")
def root():
    return {"status": "ok", "service": "QABuddy", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.post("/generate-testcases", response_model=TestCaseResponse)
def generate_testcases(req: TestCaseRequest):
    # Placeholder logic: replace with your LLM call later
    cases = [
        f"Test case {i + 1}: verify '{req.requirement}' (scenario {i + 1})"
        for i in range(req.count)
    ]
    return TestCaseResponse(requirement=req.requirement, test_cases=cases)