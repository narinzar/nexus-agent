#include <assert.h>
#include <stdio.h>
#include "ringbuf.h"

static void test_fifo(void) {
    ringbuf_t rb;
    assert(ringbuf_init(&rb, 8));
    for (int i = 0; i < 3; i++) assert(ringbuf_push(&rb, i));
    int v;
    for (int i = 0; i < 3; i++) { assert(ringbuf_pop(&rb, &v)); assert(v == i); }
    assert(!ringbuf_pop(&rb, &v));
    ringbuf_free(&rb);
}

int main(void) {
    test_fifo();
    puts("ok");
    return 0;
}
