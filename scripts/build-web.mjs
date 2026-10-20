#!/usr/bin/env node
// scripts/build-web.mjs — écrit dist/index.html, la page publiée sur GitHub Pages (spec web § 9).
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildWeb } from '../src/report/build.js';

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', buildWeb());
console.log('dist/index.html');
