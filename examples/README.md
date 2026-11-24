# Examples

## readlist: from one sentence to a finished project

[`readlist/`](readlist/) is a small Python command-line tool that keeps a reading list in a JSON file. Nexus built
it, with DeepSeek V4.1 Flash as the model, from this one sentence:

> A command-line tool in Python that keeps a personal reading list in a local JSON file: add a book, list books,
> mark a book as read, and show simple stats (total, read, unread).

Everything in `readlist/` is what Nexus and the model produced; nothing was edited by hand. The decision record of
every job is in [`readlist-run/jobs/`](readlist-run/jobs/).

### Result

- **All 6 backlog items built and merged.** 31 tests pass, lint and typecheck are clean, and `nexus handover --spec`
  passes every check.
- **Model cost: about $0.06 in total** for the spec, the skeleton and all six features.
- **23 commits, all authored by the owner's identity**, with no AI attribution.

```
$ uv run readlist --file books.json add "Dune" --author Herbert
Added #1: Dune
$ uv run readlist --file books.json add "Emma"
Added #2: Emma
$ uv run readlist --file books.json mark-read 1
Marked #1 as read: Dune
$ uv run readlist --file books.json list
#1 [x] Dune - Herbert
#2 [ ] Emma
$ uv run readlist --file books.json stats
Total: 2
Read: 1
Unread: 1
```

### What was run

| Step | Command | What happened | Cost |
|---|---|---|---|
| 1 | `nexus new "<the sentence>" --build` | Wrote [SPEC.md](readlist/SPEC.md), [BACKLOG.md](readlist/BACKLOG.md) (6 items, each naming its files and tests) and a skeleton with a [Makefile](readlist/Makefile) target for every check. The handover check failed because of a Nexus bug (below), so the backlog was correctly not started. | $0.029 |
| 2 | `nexus init`, after fixing Nexus | Commands re-detected from the Makefile; the handover check passed all 8 items. | none |
| 3 | `nexus lanes backlog --take 2 --merge` | Job 001 `add`: merged. Job 002 `list`: **needs-human**. The agent's own review approved it, but one test failed, and the test gate stopped it. | $0.007 |
| 4 | `nexus lanes backlog --take 2 --merge` | Job 003 `list`, retried: merged. Job 004 `mark-read`: merged. | $0.012 |
| 5 | `nexus lanes backlog --until-done --budget 1 --take 3` | Round 1: job 005 `stats` and job 006 data-file errors merged; job 007 end-to-end test **failed** (the agent gave up). Round 2: job 008, the retry, merged. The loop stopped with "backlog finished". | $0.016 |

Items 1 to 4 all edit `src/readlist/cli.py`, so the lanes planner put them in one lane and ran them one after another.

### What it found in Nexus

Every problem in this run was in Nexus, not in the generated project. Each was fixed before the next step, and a test
was added for it:
- **Guessed commands next to the Makefile.** `python3 -m pytest` and `mypy .` were guessed from `pyproject.toml` and
  ran outside the project's virtual environment. Now Makefile and justfile targets win, Python tools run through
  `uv run`, and commands are re-detected on every `init`. This is step 2's "Use the Makefile targets" commit.
- **Backlog items cut to their first line.** Job 001 never saw the files and tests its item named.
- **Commit subjects broken by markdown.** Job 001's commit is titled `**1`; later commits read "`list` command".
- **Agents ticked their own backlog items.** Two of them wrote wrong job numbers, which stopped Nexus from recording
  outcomes. Nexus now owns each item's outcome note. The "Record backlog outcomes" commit after step 4 was written
  with the fixed code, by hand.

### History

Recorded from the generated repository's `git log` (oldest first):

```
127b305  Start readlist: spec, backlog and skeleton        nexus new
bc287b2  Make the project ready for handover                nexus new (repair round)
43d2a4e  Use the Makefile targets for every check           nexus init, after the detection fix
d9d4d75  Start 2 backlog item(s)                            lanes: claim items 1-2
1c839e1  **1                                                job 001 (subject bug, since fixed)
697ee57  Merge branch 'job/001-...'
25453cc  Record backlog outcomes                            001 merged, 002 needs-human
4580d7e  Start 2 backlog item(s)                            claim items 2-3
6d163d2  `list` command                                     job 003
dc2febe  Merge branch 'job/003-...'
84ea7d1  `mark-read` command                                job 004
bb0749f  Merge branch 'job/004-...'
bbac56b  Record backlog outcomes
2e28a6a  Start 3 backlog item(s)                            until-done, round 1
214c57b  `stats` command                                    job 005
68207ad  Merge branch 'job/005-...'
7624f72  Data-file errors on every command                  job 006
d1e6e4c  Merge branch 'job/006-...'
b221eac  Record backlog outcomes                            007 failed, back to unchecked
887adbd  Start 1 backlog item(s)                            until-done, round 2
3f1d21d  End-to-end README example                          job 008
dcd62e2  Merge branch 'job/008-...'
ad84a26  Record backlog outcomes                            backlog finished
```

### Try it

The project needs [uv](https://docs.astral.sh/uv/):

```bash
cd examples/readlist
```
```bash
make setup
```
```bash
make test
```
```bash
uv run readlist --help
```

To reproduce the whole run on your own machine (the model output will differ):

```bash
nexus new "A command-line tool in Python that keeps a personal reading list in a local JSON file: add a book, list books, mark a book as read, and show simple stats (total, read, unread)." --build --until-done --budget 1 --model openrouter:deepseek/deepseek-v4.1-flash-1017
```
