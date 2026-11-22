BULK_THRESHOLD = 10
BULK_RATE = 0.10


def format_price(cents: int) -> str:
    """Format integer cents as dollars, e.g. 1234 -> "$12.34"."""
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return f"{sign}${cents // 100}.{cents % 100:02d}"


def apply_bulk_discount(total_cents: int, qty: int) -> int:
    """Apply the bulk discount for large orders."""
    if qty >= BULK_THRESHOLD:
        return round(total_cents * (1 - BULK_RATE))
    return total_cents
