#ifndef RINGBUF_H
#define RINGBUF_H
#include <stddef.h>
#include <stdbool.h>

/* Fixed-capacity FIFO ring buffer of ints. */
typedef struct {
    int *data;
    size_t capacity;
    size_t head;  /* next slot to read */
    size_t tail;  /* next slot to write */
    size_t count;
} ringbuf_t;

bool ringbuf_init(ringbuf_t *rb, size_t capacity);
void ringbuf_free(ringbuf_t *rb);
bool ringbuf_push(ringbuf_t *rb, int value);
bool ringbuf_pop(ringbuf_t *rb, int *out);
size_t ringbuf_size(const ringbuf_t *rb);
bool ringbuf_full(const ringbuf_t *rb);

#endif
