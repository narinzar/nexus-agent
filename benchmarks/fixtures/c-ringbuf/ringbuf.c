#include <stdlib.h>
#include "ringbuf.h"

bool ringbuf_init(ringbuf_t *rb, size_t capacity) {
    rb->data = malloc(sizeof(int) * capacity);
    if (!rb->data) return false;
    rb->capacity = capacity;
    rb->head = rb->tail = rb->count = 0;
    return true;
}

void ringbuf_free(ringbuf_t *rb) {
    free(rb->data);
    rb->data = NULL;
}

bool ringbuf_full(const ringbuf_t *rb) {
    return rb->count + 1 >= rb->capacity;
}

bool ringbuf_push(ringbuf_t *rb, int value) {
    if (ringbuf_full(rb)) return false;
    rb->data[rb->tail] = value;
    rb->tail = (rb->tail + 1) % rb->capacity;
    rb->count++;
    return true;
}

bool ringbuf_pop(ringbuf_t *rb, int *out) {
    if (rb->count == 0) return false;
    *out = rb->data[rb->head];
    rb->head = (rb->head + 1) % rb->capacity;
    rb->count--;
    return true;
}

size_t ringbuf_size(const ringbuf_t *rb) {
    return rb->count;
}
