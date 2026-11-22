package bank;

public class Account {
    private final String id;
    private long balanceCents;

    public Account(String id, long openingCents) {
        this.id = id;
        this.balanceCents = openingCents;
    }

    public String getId() { return id; }

    public long getBalanceCents() { return balanceCents; }

    void deposit(long cents) { balanceCents += cents; }

    void withdraw(long cents) {
        if (cents > balanceCents) {
            throw new InsufficientFundsException(id, cents, balanceCents);
        }
        balanceCents -= cents;
    }
}
