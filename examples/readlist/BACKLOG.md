# Backlog

Build in this order: each item is one small change an agent can implement and test on its own, and every item
names the behaviour its test checks. Keep the smoke tests in `tests/test_smoke.py` green the whole way.

- [x] **1. `add` command** - `add "<title>" [--author NAME]` appends a book with the next free id, `read` false, (done: job 001)
  `added` today, creating the file and parent directories; prints `Added #<id>: <title>`; empty title exits `2`.
  Files: `src/readlist/cli.py`. Tests in `tests/test_cli_add.py`: the book is in the file after two adds with ids 1
  and 2; `--author` is stored; empty title exits 2 and leaves the file unchanged; a missing `--file` directory is
  created.
- [x] **2. `list` command** - `list` prints one line per book in id order with id, title, author and a read marker; (done: job 003)
  `--unread` / `--read` filter, both together exit `2`; empty list prints `No books yet.` and exits `0`.
  Files: `src/readlist/cli.py`. Tests in `tests/test_cli_list.py`: three added books appear in order; the filter
  flags select the right subset; both flags exit 2; an empty file prints the empty message.
- [x] **3. `mark-read` command** - `mark-read <id>` sets `read` true and `finished` to today, prints the (done: job 004)
  confirmation; an unknown id exits `1` and leaves the file unchanged; marking a read book again is a no-op on the
  date. Files: `src/readlist/cli.py`. Tests in `tests/test_cli_mark_read.py`: a book becomes read with today's
  `finished`; a second call keeps the first date; id 99 exits 1 and the file bytes are unchanged.
- [x] **4. `stats` command** - `stats` prints `Total: N`, `Read: R`, `Unread: U` with `R + U == N`; empty or (done: job 005)
  missing file prints all zeros and exits `0`. Files: `src/readlist/cli.py`. Tests in `tests/test_cli_stats.py`:
  after two adds and one `mark-read` the counts are 2/1/1; a missing file prints zeros.
- [x] **5. Data-file errors on every command** - a corrupt or wrongly shaped file makes each of `add`, `list`, (done: job 006)
  `mark-read` and `stats` print one line on stderr and exit `1` without rewriting the file. Files:
  `src/readlist/cli.py` (one shared error wrapper around the handlers). Tests in `tests/test_cli_errors.py`: for
  each command, a corrupt file exits 1, stderr starts with `readlist:`, and the file content is unchanged.
- [x] **6. End-to-end README example** - `tests/test_e2e.py` runs the real command line through (done: job 008)
  `subprocess` with `--file` in `tmp_path`: add two books, list, mark one read, stats, and asserts the printed
  output and the file contents. Behaviour tested: the four commands compose as the README describes, and the
  README example stays true.
