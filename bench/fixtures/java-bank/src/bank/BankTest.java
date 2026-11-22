package bank;

/** Minimal dependency-free test runner: java -ea bank.BankTest */
public class BankTest {
    static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); }

    public static void main(String[] args) {
        Bank b = new Bank();
        b.open("a", 1000);
        b.open("b", 0);
        b.transfer("a", "b", 400);
        check(b.get("a").getBalanceCents() == 600, "a debited");
        check(b.get("b").getBalanceCents() == 400, "b credited");
        try { b.transfer("a", "b", 10_000); check(false, "must fail"); } catch (InsufficientFundsException e) { /* ok */ }
        check(b.totalDeposits() == 1000, "money conserved");
        System.out.println("ok");
    }
}
