#!/usr/bin/env node
"use strict";

const { readFileSync, writeFileSync, readdirSync, statSync } = require("fs");
const { join, extname, relative } = require("path");

const root = process.argv[2];
if (!root) {
  console.error("usage: node scripts/stamp-version.js <site-dir>");
  process.exit(1);
}

const versionFile = join(root, "js/version.js");
const versionText = readFileSync(versionFile, "utf8");
const match = versionText.match(/export const APP_VERSION = ["']([^"']+)["']/);
if (!match) {
  console.error("APP_VERSION not found in js/version.js");
  process.exit(1);
}

const version = match[1];

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function stampJs(source) {
  return source.replace(
    /from\s+(["'])(\.[^"']+\.js)(\?v=[^"']*)?\1/g,
    (_, quote, path) => `from ${quote}${path}?v=${version}${quote}`,
  );
}

function stampHtml(source) {
  return source.replace(
    /\b(href|src)="((?:css|js)\/[^"]+\.(?:css|js))(\?v=[^"]*)?"/g,
    (_, attr, path) => `${attr}="${path}?v=${version}"`,
  );
}

let changed = 0;
for (const file of walk(root)) {
  const ext = extname(file);
  const original = readFileSync(file, "utf8");
  let next = original;
  if (ext === ".js") next = stampJs(original);
  if (ext === ".html") next = stampHtml(original);
  if (next !== original) {
    writeFileSync(file, next);
    changed += 1;
    console.log(`stamped ${relative(root, file)}`);
  }
}

console.log(`APP_VERSION ${version} → ${changed} files`);
