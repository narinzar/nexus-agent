---
name: testing
description: Writing and running focused, meaningful tests in any language and framework (pytest, go test, cargo test, JUnit, xUnit, Jest/Vitest, RSpec, PHPUnit, ctest). Use when adding tests, when a change needs coverage, or when choosing which tests to run after an edit.
---

# Testing

**Pick the narrowest command that proves the change.** Run broader suites before shipping.

| Ecosystem | One test | One file or package |
|---|---|---|
| Python | `pytest path::test_name -q` | `pytest path -q` |
| Go | `go test ./pkg/x -run TestName` | `go test ./pkg/x` |
| Rust | `cargo test test_name` | `cargo test --test file` |
| JVM | `mvn -q test -Dtest=Class#method` | `gradle test --tests Class` |
| .NET | `dotnet test --filter Name` | — |
| JS | `npx vitest run -t name` / `npx jest -t name` | `node --test file` |
| Ruby | `bundle exec rspec file:line` | — |
| C/C++ | `ctest -R name --test-dir build` | — |

**Writing tests**
- Follow the existing test layout, naming, fixtures and helpers: look at a neighbouring test file first.
- Test behaviour through the public interface. Each test checks one thing, with a name that states it.
- Cover the case that motivated the change, plus an edge (empty, zero, boundary, error path).
- No sleeps, network or real clocks. Use the project's fakes. Keep tests deterministic and independent.
- A test must fail without the change. Check this when practical.

**Reading failures**
- Fix the first failure first.
- Distinguish a wrong assertion from wrong code before editing either.
