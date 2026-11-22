from dataclasses import dataclass


@dataclass
class Item:
    sku: str
    name: str
    price_cents: int
    qty: int = 0

    def value_cents(self) -> int:
        return self.price_cents * self.qty
