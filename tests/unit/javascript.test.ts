import { describe, expect, it } from 'vitest';
import { analyzeJavaScript } from '../../app/lib/analyzer/analyzers/javascript';
import type { DiscoveredFile } from '../../app/lib/analyzer/types';

describe('JavaScript & TypeScript Analyzer', () => {
  it('extracts React components, interfaces, imports, and calls', () => {
    const file: DiscoveredFile = {
      path: 'src/components/UserProfile.tsx',
      size: 500,
      hash: 'js1',
      content: `
import React, { useState } from 'react';
import { fetchUserData } from '../services/api';

export interface ProfileProps {
  userId: string;
}

export function UserProfile({ userId }: ProfileProps) {
  const [data, setData] = useState(null);
  fetchUserData(userId);
  return <div>{userId}</div>;
}
`,
    };

    const analysis = analyzeJavaScript(file);
    expect(analysis.file.language).toBe('TypeScript');

    // Component symbol
    const comp = analysis.symbols.find((s) => s.name === 'UserProfile');
    expect(comp?.type).toBe('component');
    expect(comp?.exported).toBe(true);

    // Interface symbol
    const iface = analysis.symbols.find((s) => s.name === 'ProfileProps');
    expect(iface?.type).toBe('interface');

    // Imports & calls
    expect(analysis.imports.some((i) => i.module === '../services/api')).toBe(true);
    expect(analysis.calls.some((c) => c.callee === 'fetchUserData')).toBe(true);
  });

  it('extracts Express routes and handlers', () => {
    const file: DiscoveredFile = {
      path: 'src/routes/api.js',
      size: 400,
      hash: 'js2',
      content: `
const express = require('express');
const router = express.Router();

function getItems(req, res) {
  res.json([]);
}

router.get('/items', getItems);
router.post('/items', (req, res) => res.send('ok'));
`,
    };

    const analysis = analyzeJavaScript(file);
    expect(analysis.routes.length).toBe(2);
    expect(analysis.routes[0].path).toBe('/items');
    expect(analysis.routes[0].method).toBe('GET');
    expect(analysis.routes[0].framework).toBe('Express');
    expect(analysis.routes[1].method).toBe('POST');
  });

  it('extracts NestJS controllers and HTTP methods', () => {
    const file: DiscoveredFile = {
      path: 'src/cats/cats.controller.ts',
      size: 400,
      hash: 'js3',
      content: `
import { Controller, Get, Post, Param } from '@nestjs/common';

@Controller('cats')
export class CatsController {
  @Get()
  findAll() {
    return [];
  }

  @Post(':id')
  create(@Param('id') id: string) {
    return id;
  }
}
`,
    };

    const analysis = analyzeJavaScript(file);
    expect(analysis.frameworks.has('NestJS')).toBe(true);
    expect(analysis.routes.length).toBe(2);
    expect(analysis.routes[0].path).toBe('/cats');
    expect(analysis.routes[0].method).toBe('GET');
    expect(analysis.routes[1].path).toBe('/cats/:id');
    expect(analysis.routes[1].method).toBe('POST');
  });

  it('extracts Next.js App Router route groups and route handlers', () => {
    const file: DiscoveredFile = {
      path: 'app/(auth)/login/route.ts',
      size: 300,
      hash: 'js4',
      content: `
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  return NextResponse.json({ ok: true });
}
`,
    };

    const analysis = analyzeJavaScript(file);
    expect(analysis.frameworks.has('Next.js')).toBe(true);
    expect(analysis.routes.length).toBe(1);
    expect(analysis.routes[0].path).toBe('/login');
    expect(analysis.routes[0].method).toBe('POST');
  });
});
