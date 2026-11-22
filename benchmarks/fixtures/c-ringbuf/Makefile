CC ?= cc
CFLAGS ?= -Wall -Wextra -O1 -g

test: test_ringbuf
	./test_ringbuf

test_ringbuf: test_ringbuf.c ringbuf.c ringbuf.h
	$(CC) $(CFLAGS) -o $@ test_ringbuf.c ringbuf.c

clean:
	rm -f test_ringbuf

.PHONY: test clean
