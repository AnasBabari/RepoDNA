import { describe, expect, it } from 'vitest';
import { analyzeRepositoryFiles } from '../../app/lib/analyzer';
import type { DiscoveredFile } from '../../app/lib/analyzer/types';

describe('Pre-cached Golden Sample Artifacts', () => {
  it('generates and validates featured user repository samples (Strix, nanoGPT, Full-Stack FastAPI)', async () => {
    // 1. Strix (usestrix/strix) Sample
    const strixFiles: DiscoveredFile[] = [
      {
        path: 'pyproject.toml',
        size: 350,
        hash: 'strix_p1',
        content: `[project]\nname = "strix"\nversion = "0.1.0"\ndescription = "Open-source AI penetration testing tool"\ndependencies = ["fastapi", "pydantic", "langchain", "httpx", "rich"]\n`,
      },
      {
        path: 'package.json',
        size: 350,
        hash: 'strix_p2',
        content: JSON.stringify({
          name: 'strix-ui',
          version: '0.1.0',
          dependencies: {
            next: '^15.0.0',
            react: '^19.0.0',
            'react-dom': '^19.0.0',
            'lucide-react': '^0.400.0',
            tailwindcss: '^3.4.0',
          },
        }),
      },
      {
        path: 'strix/main.py',
        size: 900,
        hash: 'strix_1',
        content: `
from fastapi import FastAPI
from strix.api.routes import scan_router, target_router
from strix.core.scanner import SecurityScanner

app = FastAPI(title="Strix Security Agent")
app.include_router(scan_router, prefix="/api/v1/scans")
app.include_router(target_router, prefix="/api/v1/targets")
`,
      },
      {
        path: 'strix/api/routes.py',
        size: 1100,
        hash: 'strix_2',
        content: `
from fastapi import APIRouter
from strix.models.scan import ScanRequest, ScanResult
from strix.services.agent import PentestAgent

scan_router = APIRouter(tags=["scans"])
target_router = APIRouter(tags=["targets"])

@scan_router.post("/start", response_model=ScanResult)
def start_security_scan(request: ScanRequest):
    agent = PentestAgent()
    return agent.run_audit(request.target_url)

@scan_router.get("/{scan_id}")
def get_scan_report(scan_id: str):
    agent = PentestAgent()
    return agent.get_report(scan_id)
`,
      },
      {
        path: 'strix/core/scanner.py',
        size: 1200,
        hash: 'strix_3',
        content: `
from strix.tools.crawler import WebCrawler
from strix.tools.fuzzer import ApiFuzzer
from strix.models.scan import VulnerabilityReport

class SecurityScanner:
    def __init__(self, target_url: str):
        self.crawler = WebCrawler(target_url)
        self.fuzzer = ApiFuzzer(target_url)

    def scan_endpoints(self) -> VulnerabilityReport:
        endpoints = self.crawler.discover_endpoints()
        return self.fuzzer.audit_routes(endpoints)
`,
      },
      {
        path: 'strix/services/agent.py',
        size: 950,
        hash: 'strix_4',
        content: `
from strix.core.scanner import SecurityScanner
from strix.models.scan import ScanResult

class PentestAgent:
    def run_audit(self, target_url: str) -> ScanResult:
        scanner = SecurityScanner(target_url)
        report = scanner.scan_endpoints()
        return ScanResult(target=target_url, status="completed", vulnerabilities=report.items)

    def get_report(self, scan_id: str):
        return {"scan_id": scan_id, "status": "completed"}
`,
      },
      {
        path: 'strix/models/scan.py',
        size: 650,
        hash: 'strix_5',
        content: `
from pydantic import BaseModel
from typing import List, Optional

class ScanRequest(BaseModel):
    target_url: str
    deep_scan: bool = True

class VulnerabilityReport(BaseModel):
    items: List[str] = []
    severity: str = "medium"

class ScanResult(BaseModel):
    target: str
    status: str
    vulnerabilities: List[str]
`,
      },
      {
        path: 'strix/tools/crawler.py',
        size: 750,
        hash: 'strix_6',
        content: `
class WebCrawler:
    def __init__(self, base_url: str):
        self.base_url = base_url

    def discover_endpoints(self) -> list:
        return ["/login", "/api/user", "/admin"]
`,
      },
      {
        path: 'strix/tools/fuzzer.py',
        size: 800,
        hash: 'strix_7',
        content: `
from strix.models.scan import VulnerabilityReport

class ApiFuzzer:
    def __init__(self, base_url: str):
        self.base_url = base_url

    def audit_routes(self, routes: list) -> VulnerabilityReport:
        return VulnerabilityReport(items=["SQLi detected on /login", "CORS misconfiguration on /api/user"])
`,
      },
      {
        path: 'app/page.tsx',
        size: 900,
        hash: 'strix_8',
        content: `
import React from 'react';

export default function Dashboard() {
  return (
    <div className="p-8">
      <h1>Strix Security Audit Console</h1>
      <p>Autonomous AI Penetration Testing & Vulnerability Scanner</p>
    </div>
  );
}
`,
      },
    ];

    // 2. nanoGPT (karpathy/nanoGPT) Sample
    const nanogptFiles: DiscoveredFile[] = [
      {
        path: 'requirements.txt',
        size: 120,
        hash: 'ng_p1',
        content: 'torch>=2.0.0\nnumpy>=1.24.0\ntransformers>=4.30.0\ndatasets>=2.14.0\ntiktoken>=0.4.0\nwandb>=0.15.0\n',
      },
      {
        path: 'model.py',
        size: 2400,
        hash: 'ng_1',
        content: `
import math
import torch
import torch.nn as nn
from torch.nn import functional as F

class GPTConfig:
    block_size: int = 1024
    vocab_size: int = 50304
    n_layer: int = 12
    n_head: int = 12
    n_embd: int = 768
    dropout: float = 0.0
    bias: bool = True

class CausalSelfAttention(nn.Module):
    def __init__(self, config: GPTConfig):
        super().__init__()
        self.c_attn = nn.Linear(config.n_embd, 3 * config.n_embd, bias=config.bias)
        self.c_proj = nn.Linear(config.n_embd, config.n_embd, bias=config.bias)
        self.attn_dropout = nn.Dropout(config.dropout)
        self.resid_dropout = nn.Dropout(config.dropout)
        self.n_head = config.n_head
        self.n_embd = config.n_embd

    def forward(self, x):
        B, T, C = x.size()
        q, k, v = self.c_attn(x).split(self.n_embd, dim=2)
        y = torch.nn.functional.scaled_dot_product_attention(q, k, v, is_causal=True)
        return self.resid_dropout(self.c_proj(y))

class MLP(nn.Module):
    def __init__(self, config: GPTConfig):
        super().__init__()
        self.c_fc = nn.Linear(config.n_embd, 4 * config.n_embd, bias=config.bias)
        self.gelu = nn.GELU()
        self.c_proj = nn.Linear(4 * config.n_embd, config.n_embd, bias=config.bias)
        self.dropout = nn.Dropout(config.dropout)

    def forward(self, x):
        return self.dropout(self.c_proj(self.gelu(self.c_fc(x))))

class Block(nn.Module):
    def __init__(self, config: GPTConfig):
        super().__init__()
        self.ln_1 = nn.LayerNorm(config.n_embd, bias=config.bias)
        self.attn = CausalSelfAttention(config)
        self.ln_2 = nn.LayerNorm(config.n_embd, bias=config.bias)
        self.mlp = MLP(config)

    def forward(self, x):
        x = x + self.attn(self.ln_1(x))
        x = x + self.mlp(self.ln_2(x))
        return x

class GPT(nn.Module):
    def __init__(self, config: GPTConfig):
        super().__init__()
        self.config = config
        self.transformer = nn.ModuleDict(dict(
            wte = nn.Embedding(config.vocab_size, config.n_embd),
            wpe = nn.Embedding(config.block_size, config.n_embd),
            drop = nn.Dropout(config.dropout),
            h = nn.ModuleList([Block(config) for _ in range(config.n_layer)]),
            ln_f = nn.LayerNorm(config.n_embd, bias=config.bias),
        ))
        self.lm_head = nn.Linear(config.n_embd, config.vocab_size, bias=False)

    def forward(self, idx, targets=None):
        tok_emb = self.transformer.wte(idx)
        return self.lm_head(tok_emb)
`,
      },
      {
        path: 'train.py',
        size: 1400,
        hash: 'ng_2',
        content: `
import os
import time
import torch
from model import GPT, GPTConfig

def train_gpt():
    config = GPTConfig()
    model = GPT(config)
    optimizer = torch.optim.AdamW(model.parameters(), lr=6e-4)
    return model, optimizer

if __name__ == '__main__':
    train_gpt()
`,
      },
      {
        path: 'sample.py',
        size: 800,
        hash: 'ng_3',
        content: `
import torch
from model import GPT, GPTConfig

def generate_sample(prompt: str = "Hello, I am a language model,"):
    config = GPTConfig()
    model = GPT(config)
    model.eval()
    return f"{prompt} trained with nanoGPT."
`,
      },
    ];

    // 3. Full-Stack FastAPI Template (tiangolo/full-stack-fastapi-template) Sample
    const templateFiles: DiscoveredFile[] = [
      {
        path: 'pyproject.toml',
        size: 400,
        hash: 'fst_p1',
        content: `[project]\nname = "full-stack-fastapi-template"\nversion = "0.1.0"\ndependencies = ["fastapi", "sqlmodel", "pydantic", "alembic", "psycopg2-binary", "celery"]\n`,
      },
      {
        path: 'frontend/package.json',
        size: 400,
        hash: 'fst_p2',
        content: JSON.stringify({
          name: 'frontend',
          version: '0.1.0',
          dependencies: {
            react: '^18.3.0',
            'react-dom': '^18.3.0',
            '@tanstack/react-query': '^5.0.0',
            '@chakra-ui/react': '^2.8.0',
            vite: '^5.0.0',
          },
        }),
      },
      {
        path: 'backend/app/main.py',
        size: 900,
        hash: 'fst_1',
        content: `
from fastapi import FastAPI
from app.api.main import api_router
from app.core.config import settings

app = FastAPI(title=settings.PROJECT_NAME)
app.include_router(api_router, prefix=settings.API_V1_STR)
`,
      },
      {
        path: 'backend/app/api/main.py',
        size: 700,
        hash: 'fst_2',
        content: `
from fastapi import APIRouter
from app.api.routes import items, users, login

api_router = APIRouter()
api_router.include_router(login.router, tags=["login"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(items.router, prefix="/items", tags=["items"])
`,
      },
      {
        path: 'backend/app/api/routes/users.py',
        size: 1100,
        hash: 'fst_3',
        content: `
from fastapi import APIRouter, Depends
from app.models.user import User, UserCreate, UserPublic
from app.crud.crud_user import user_crud

router = APIRouter()

@router.get("/", response_model=list[UserPublic])
def read_users():
    return user_crud.get_multi()

@router.post("/", response_model=UserPublic)
def create_user(user_in: UserCreate):
    return user_crud.create(user_in)
`,
      },
      {
        path: 'backend/app/api/routes/items.py',
        size: 900,
        hash: 'fst_4',
        content: `
from fastapi import APIRouter, Depends
from app.models.item import Item, ItemCreate, ItemPublic
from app.crud.crud_item import item_crud

router = APIRouter()

@router.get("/", response_model=list[ItemPublic])
def read_items():
    return item_crud.get_multi()

@router.post("/", response_model=ItemPublic)
def create_item(item_in: ItemCreate):
    return item_crud.create(item_in)
`,
      },
      {
        path: 'backend/app/models/user.py',
        size: 700,
        hash: 'fst_5',
        content: `
from sqlmodel import Field, SQLModel
from typing import Optional

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str
    is_active: bool = True
    is_superuser: bool = False

class UserCreate(SQLModel):
    email: str
    password: str

class UserPublic(SQLModel):
    id: int
    email: str
    is_active: bool
`,
      },
      {
        path: 'backend/app/models/item.py',
        size: 600,
        hash: 'fst_6',
        content: `
from sqlmodel import Field, SQLModel
from typing import Optional

class Item(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: Optional[str] = None
    owner_id: Optional[int] = Field(default=None, foreign_key="user.id")

class ItemCreate(SQLModel):
    title: str
    description: Optional[str] = None

class ItemPublic(SQLModel):
    id: int
    title: str
    description: Optional[str]
`,
      },
      {
        path: 'backend/app/crud/crud_user.py',
        size: 700,
        hash: 'fst_7',
        content: `
from app.models.user import User, UserCreate

class CRUDUser:
    def get_multi(self):
        return []
    def create(self, obj_in: UserCreate):
        return User(id=1, email=obj_in.email, hashed_password="***", is_active=True)

user_crud = CRUDUser()
`,
      },
      {
        path: 'backend/app/crud/crud_item.py',
        size: 700,
        hash: 'fst_8',
        content: `
from app.models.item import Item, ItemCreate

class CRUDItem:
    def get_multi(self):
        return []
    def create(self, obj_in: ItemCreate):
        return Item(id=1, title=obj_in.title, description=obj_in.description)

item_crud = CRUDItem()
`,
      },
      {
        path: 'frontend/src/App.tsx',
        size: 600,
        hash: 'fst_9',
        content: `
import React from 'react';

export function App() {
  return (
    <div>
      <h1>Full Stack FastAPI Dashboard</h1>
    </div>
  );
}
`,
      },
    ];

    // Generate Strix Artifact
    const strixProject = await analyzeRepositoryFiles(
      { name: 'strix', source: 'https://github.com/usestrix/strix', files: strixFiles, skipped: [] },
      {}
    );
    // Generate nanoGPT Artifact
    const nanogptProject = await analyzeRepositoryFiles(
      { name: 'nanoGPT', source: 'https://github.com/karpathy/nanoGPT', files: nanogptFiles, skipped: [] },
      {}
    );
    // Generate Full-Stack FastAPI Template Artifact
    const templateProject = await analyzeRepositoryFiles(
      { name: 'full-stack-fastapi-template', source: 'https://github.com/tiangolo/full-stack-fastapi-template', files: templateFiles, skipped: [] },
      {}
    );
    // Verify generated artifacts
    expect(strixProject.repository.name).toBe('strix');
    expect(strixProject.architecture.components.length).toBeGreaterThan(0);
    expect(strixProject.routes.length).toBeGreaterThan(0);

    expect(nanogptProject.repository.name).toBe('nanoGPT');
    expect(nanogptProject.symbols.length).toBeGreaterThan(0);

    expect(templateProject.repository.name).toBe('full-stack-fastapi-template');
    expect(templateProject.architecture.components.length).toBeGreaterThan(0);
    expect(templateProject.routes.length).toBeGreaterThan(0);
  });
});
