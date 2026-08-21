import { describe, expect, it } from 'vitest';
import { analyzePython } from '../../app/lib/analyzer/analyzers/python';
import type { DiscoveredFile } from '../../app/lib/analyzer/types';

describe('Python Analyzer', () => {
  it('extracts classes, models, functions, routes, imports, and calls', () => {
    const file: DiscoveredFile = {
      path: 'app/routers/users.py',
      size: 600,
      hash: 'py1',
      content: `
from fastapi import APIRouter, Depends
from app.models import Base
from app.services import UserService

router = APIRouter(prefix="/api/v1/users")

class UserModel(Base):
    pass

@router.get("/")
async def list_users():
    return UserService.get_all()

@router.post("/{user_id}")
async def create_user(user_id: str):
    return UserService.save(user_id)
`,
    };

    const analysis = analyzePython(file);
    expect(analysis.file.language).toBe('Python');
    expect(analysis.file.parsed).toBe(true);

    // Symbols
    const modelSymbol = analysis.symbols.find((s) => s.name === 'UserModel');
    expect(modelSymbol).toBeDefined();
    expect(modelSymbol?.type).toBe('database_model');

    const funcSymbols = analysis.symbols.filter((s) => s.type === 'function');
    expect(funcSymbols.map((s) => s.name)).toContain('list_users');
    expect(funcSymbols.map((s) => s.name)).toContain('create_user');

    // Routes with prefix inheritance
    expect(analysis.routes.length).toBe(2);
    expect(analysis.routes[0].path).toBe('/api/v1/users');
    expect(analysis.routes[0].method).toBe('GET');
    expect(analysis.routes[1].path).toBe('/api/v1/users/{user_id}');
    expect(analysis.routes[1].method).toBe('POST');

    // Calls
    expect(analysis.calls.some((c) => c.callee === 'UserService.get_all')).toBe(true);
    expect(analysis.calls.some((c) => c.callee === 'UserService.save')).toBe(true);
  });

  it('extracts Flask routes with Blueprint url_prefix and methods', () => {
    const file: DiscoveredFile = {
      path: 'routes/auth.py',
      size: 400,
      hash: 'py2',
      content: `
from flask import Blueprint, request

auth_bp = Blueprint('auth', __name__, url_prefix='/auth')

@auth_bp.route('/login', methods=['POST'])
def login():
    return authenticate()
`,
    };

    const analysis = analyzePython(file);
    expect(analysis.routes.length).toBe(1);
    expect(analysis.routes[0].path).toBe('/auth/login');
    expect(analysis.routes[0].method).toBe('POST');
    expect(analysis.routes[0].framework).toBe('Flask');
  });

  it('extracts SQLModel and Beanie database models', () => {
    const file: DiscoveredFile = {
      path: 'models.py',
      size: 400,
      hash: 'py3',
      content: `
from sqlmodel import SQLModel, Field
from beanie import Document

class Item(SQLModel, table=True):
    id: int

class MongoUser(Document):
    name: str
`,
    };

    const analysis = analyzePython(file);
    const item = analysis.symbols.find((s) => s.name === 'Item');
    const mongoUser = analysis.symbols.find((s) => s.name === 'MongoUser');

    expect(item?.type).toBe('database_model');
    expect(mongoUser?.type).toBe('database_model');
    expect(analysis.databases.has('MongoDB')).toBe(true);
  });
});
