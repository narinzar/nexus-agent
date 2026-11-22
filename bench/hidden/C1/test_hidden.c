#include <assert.h>
#include <stdio.h>
#include "ringbuf.h"

int main(void) {
    ringbuf_t rb;
    assert(ringbuf_init(&rb, 4));
    for (int i = 0; i < 4; i++) assert(ringbuf_push(&rb, i));
    assert(ringbuf_full(&rb));
    assert(!ringbuf_push(&rb, 99));
    int v;
    assert(ringbuf_pop(&rb, &v) && v == 0);
    assert(ringbuf_push(&rb, 4));
    for (int i = 1; i <= 4; i++) { assert(ringbuf_pop(&rb, &v)); assert(v == i); }
    ringbuf_free(&rb);
    puts("hidden ok");
    return 0;
}
