from .pricing import format_price
from .store import Store

TITLE = "Inventory Report"


def render_report(store: Store) -> list[str]:
    lines = [TITLE, "=" * len(TITLE)]
    for item in store.items():
        lines.append(f"{item.sku:<8} {item.name:<20} {item.qty:>5} @ {format_price(item.price_cents)}")
    lines.append(f"Total value: {format_price(store.total_value())}")
    low = store.low_stock()
    if low:
        lines.append("Low stock: " + ", ".join(i.sku for i in low))
    return lines
