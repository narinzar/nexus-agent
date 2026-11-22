from .models import Item
from .pricing import apply_bulk_discount


class Store:
    def __init__(self):
        self._items: dict[str, Item] = {}

    def add_item(self, item: Item) -> None:
        if item.sku in self._items:
            self._items[item.sku].qty += item.qty
        else:
            self._items[item.sku] = item

    def remove(self, sku: str, qty: int) -> None:
        item = self.find_by_sku(sku)
        if item is None:
            raise KeyError(sku)
        if qty > item.qty:
            raise ValueError("not enough stock")
        item.qty -= qty

    def find_by_sku(self, sku: str):
        return self._items.get(sku)

    def items(self):
        return sorted(self._items.values(), key=lambda i: i.sku)

    def low_stock(self, threshold: int = 5):
        return [i for i in self.items() if i.qty <= threshold]

    def total_value(self) -> int:
        return sum(i.value_cents() for i in self.items())

    def order_total(self, sku: str, qty: int) -> int:
        item = self.find_by_sku(sku)
        if item is None:
            raise KeyError(sku)
        return apply_bulk_discount(item.price_cents * qty, qty)
