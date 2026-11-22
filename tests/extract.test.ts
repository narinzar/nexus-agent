import { test } from "node:test";
import assert from "node:assert/strict";
import { heuristicProvider } from "../src/intel/heuristic/index.ts";
import { treeSitterProvider, initTreeSitter } from "../src/intel/treesitter.ts";

// Each case: language, file name, source, expected symbol names (with kinds), imports, calls.
const CASES: { lang: string; file: string; src: string; syms: string[]; imports?: string[]; calls?: string[] }[] = [
  { lang: "python", file: "app/service.py", src: `import os
from .models import User, Order as O

class UserService(BaseService):
    """Users."""
    def get(self, uid):
        return User.find(uid)

    def _cache(self):
        pass

def create_app(config=None):
    svc = UserService()
    return svc.get(1)
`, syms: ["class UserService", "method UserService.get", "method UserService._cache", "function create_app"], imports: ["os", ".models"], calls: ["find", "UserService", "get"] },
  { lang: "go", file: "pkg/store/store.go", src: `package store

import (
	"fmt"
	db "github.com/acme/app/internal/db"
)

type Store struct {
	conn *db.Conn
}

type Reader interface {
	Read(id int) (string, error)
}

func New(c *db.Conn) *Store {
	return &Store{conn: c}
}

func (s *Store) Read(id int) (string, error) {
	return fmt.Sprintf("%d", id), s.conn.Ping()
}
`, syms: ["struct Store", "interface Reader", "function New", "method Store.Read"], imports: ["fmt", "github.com/acme/app/internal/db"], calls: ["Sprintf", "Ping"] },
  { lang: "rust", file: "src/engine.rs", src: `use std::collections::HashMap;
use crate::config::{Config, Mode};
mod parser;

pub struct Engine {
    cache: HashMap<String, u32>,
}

pub trait Runner {
    fn run(&self) -> u32;
}

impl Runner for Engine {
    fn run(&self) -> u32 {
        compute(self.cache.len())
    }
}

pub fn compute(n: usize) -> u32 {
    n as u32
}
`, syms: ["struct Engine", "trait Runner", "function compute"], imports: ["std::collections::HashMap", "crate::config::Config", "crate::config::Mode", "parser"], calls: ["compute"] },
  { lang: "java", file: "src/main/java/com/acme/OrderService.java", src: `package com.acme;

import java.util.List;
import com.acme.repo.OrderRepository;

public class OrderService extends BaseService implements Auditable {
    private final OrderRepository repo;

    public OrderService(OrderRepository repo) {
        this.repo = repo;
    }

    public List<Order> findOpen(int limit) {
        return repo.findByStatus("OPEN", limit);
    }
}
`, syms: ["class OrderService", "method OrderService.findOpen"], imports: ["java.util.List", "com.acme.repo.OrderRepository"], calls: ["findByStatus"] },
  { lang: "csharp", file: "Billing/InvoiceService.cs", src: `using System;
using Acme.Billing.Models;

namespace Acme.Billing
{
    public class InvoiceService : IInvoiceService
    {
        public decimal Total(Invoice inv)
        {
            return Calculator.Sum(inv.Lines);
        }
    }
}
`, syms: ["class InvoiceService", "method InvoiceService.Total"], imports: ["System", "Acme.Billing.Models"], calls: ["Sum"] },
  { lang: "cpp", file: "src/buffer.cpp", src: `#include "buffer.h"
#include <vector>

namespace io {

class Buffer {
public:
    void write(const char* data);
};

void Buffer::write(const char* data) {
    append(data, strlen(data));
}

int checksum(const std::vector<int>& v) {
    return accumulate(v);
}

}
`, syms: ["class Buffer", "function checksum"], imports: ["buffer.h", "vector"], calls: ["append", "strlen", "accumulate"] },
  { lang: "ruby", file: "lib/cart.rb", src: `require_relative "item"

class Cart < Base
  def add(item)
    items.push(item)
  end

  def total
    items.sum(&:price)
  end
end
`, syms: ["class Cart", "method Cart.add", "method Cart.total"], imports: ["item"], calls: ["push", "sum"] },
  { lang: "php", file: "src/Mailer.php", src: `<?php
namespace App;

use App\\Contracts\\Transport;

class Mailer implements Transport
{
    public function send(string $to): bool
    {
        return $this->transport->deliver($to);
    }
}
`, syms: ["class Mailer", "method Mailer.send"], imports: ["App\\Contracts\\Transport"], calls: ["deliver"] },
  { lang: "tsx", file: "src/components/Nav.tsx", src: `import { useState } from "react";
import Button from "./Button";

export function Nav({ pages }: { pages: string[] }) {
  const [i, setI] = useState(0);
  return (
    <nav className="nav-bar">
      <Button onClick={() => setI(i - 1)}>Previous</Button>
      <Button onClick={() => setI(i + 1)}>Next</Button>
    </nav>
  );
}

export const LIMIT = 10;
`, syms: ["component Nav", "const LIMIT"], imports: ["react", "./Button"], calls: ["useState", "setI"] },
  { lang: "shell", file: "scripts/deploy.sh", src: `#!/bin/bash
source ./env.sh

build() {
  docker build -t app .
}

deploy() {
  build
  kubectl apply -f k8s/
}
`, syms: ["function build", "function deploy"], imports: ["./env.sh"] },
];

const HEURISTIC_ONLY = [
  { lang: "hcl", file: "infra/main.tf", src: `module "vpc" {\n  source = "./modules/vpc"\n}\n\nresource "aws_instance" "web" {\n  ami = var.ami\n  subnet_id = module.vpc.subnet\n}\n\nvariable "ami" {}\n`, syms: ["resource aws_instance.web", "module module.vpc", "variable var.ami"], imports: ["./modules/vpc"] },
  { lang: "sql", file: "db/schema.sql", src: `CREATE TABLE users (\n  id serial primary key\n);\n\nCREATE TABLE orders (\n  user_id int REFERENCES users(id)\n);\n\nCREATE OR REPLACE VIEW open_orders AS SELECT * FROM orders;\n`, syms: ["table users", "table orders", "view open_orders"] },
  { lang: "dockerfile", file: "Dockerfile", src: `FROM node:22 AS build\nRUN npm ci\nFROM nginx:alpine\nCOPY --from=build /app/dist /usr/share/nginx/html\nCMD ["nginx"]\n`, syms: ["stage build"], imports: ["node:22", "nginx:alpine"] },
  { lang: "yaml", file: ".github/workflows/ci.yml", src: `name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n  lint:\n    runs-on: ubuntu-latest\n`, syms: ["job test", "job lint"], imports: ["actions/checkout"] },
  { lang: "gdscript", file: "player.gd", src: `extends CharacterBody2D\nclass_name Player\n\nsignal died\n\nfunc _physics_process(delta):\n\tmove_and_slide()\n\nfunc take_damage(n):\n\thealth -= n\n`, syms: ["class Player", "signal died", "function _physics_process", "function take_damage"] },
  { lang: "kotlin", file: "app/src/main/kotlin/Repo.kt", src: `package app\n\nimport kotlinx.coroutines.flow.Flow\n\nclass Repo(private val api: Api) {\n    fun load(id: Int): Flow<Item> {\n        return api.fetch(id)\n    }\n}\n`, syms: ["class Repo", "method Repo.load"], imports: ["kotlinx.coroutines.flow.Flow"] },
  { lang: "swift", file: "Sources/App/Cache.swift", src: `import Foundation\n\nstruct Cache {\n    func get(_ key: String) -> Data? {\n        return store.value(forKey: key)\n    }\n}\n`, syms: ["class Cache", "method Cache.get"], imports: ["Foundation"] },
  { lang: "zig", file: "src/main.zig", src: `const std = @import("std");\n\npub fn main() !void {\n    try run();\n}\n\nfn run() !void {}\n\ntest "run works" {\n    try run();\n}\n`, syms: ["function main", "function run", "test run works"], imports: ["std"] },
];

function check(facts: any, c: any, label: string) {
  assert.ok(facts, `${label}: no facts`);
  const have = new Set(facts.symbols.map((s: any) => `${s.kind} ${s.name}`));
  const names = new Set(facts.symbols.map((s: any) => s.name));
  for (const s of c.syms) { const [kind, ...rest] = s.split(" "); const name = rest.join(" "); assert.ok(have.has(s) || (names.has(name) && ["class", "struct", "method", "function", "component", "const"].includes(kind)), `${label}: missing symbol ${s}; have ${[...have].join(", ")}`); }
  for (const i of c.imports || []) assert.ok(facts.imports.some((x: any) => x.source === i), `${label}: missing import ${i}; have ${facts.imports.map((x: any) => x.source).join(", ")}`);
  for (const n of c.calls || []) assert.ok(facts.refs.some((r: any) => (r.kind === "call" || r.kind === "mcall") && r.name === n), `${label}: missing call ${n}`);
  for (const s of facts.symbols) assert.ok(s.end >= s.line, `${label}: bad span for ${s.name}`);
}

for (const c of [...CASES, ...HEURISTIC_ONLY]) test(`heuristic: ${c.lang}`, () => check(heuristicProvider.extract(c.src, c.file, c.lang), c, `heuristic ${c.lang}`));

test("tree-sitter: all bundled languages", async (t) => {
  if (!(await initTreeSitter())) return t.skip("optional @vscode/tree-sitter-wasm not installed");
  for (const c of CASES) {
    if (!treeSitterProvider.languages().includes(c.lang)) continue;
    check(treeSitterProvider.extract(c.src, c.file, c.lang), c, `tree-sitter ${c.lang}`);
  }
});

test("tree-sitter reports syntax errors", async (t) => {
  if (!(await initTreeSitter())) return t.skip("no tree-sitter");
  const f = treeSitterProvider.extract("def f(:\n  return 1\n", "x.py", "python")!;
  assert.ok(f.syntaxErrors!.length > 0);
});
