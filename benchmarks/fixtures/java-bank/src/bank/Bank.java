package bank;

import java.util.HashMap;
import java.util.Map;

public class Bank {
    private final Map<String, Account> accounts = new HashMap<>();

    public Account open(String id, long openingCents) {
        if (accounts.containsKey(id)) throw new IllegalStateException("duplicate account " + id);
        Account a = new Account(id, openingCents);
        accounts.put(id, a);
        return a;
    }

    public Account get(String id) {
        Account a = accounts.get(id);
        if (a == null) throw new IllegalArgumentException("no account " + id);
        return a;
    }

    /** Move money between two accounts atomically. */
    public void transfer(String from, String to, long cents) {
        Account src = get(from);
        Account dst = get(to);
        src.withdraw(cents);
        dst.deposit(cents);
    }

    public long totalDeposits() {
        long sum = 0;
        for (Account a : accounts.values()) sum += a.getBalanceCents();
        return sum;
    }
}
