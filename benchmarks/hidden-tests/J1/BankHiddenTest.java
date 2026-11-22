package bank;

public class BankHiddenTest {
    public static void main(String[] args) {
        Bank b = new Bank();
        b.open("a", 1000);
        b.open("b", 0);
        for (long bad : new long[] {0, -5}) {
            try { b.transfer("a", "b", bad); throw new AssertionError("transfer of " + bad + " must fail"); }
            catch (IllegalArgumentException e) { /* expected */ }
        }
        if (b.get("a").getBalanceCents() != 1000 || b.get("b").getBalanceCents() != 0) throw new AssertionError("balances changed");
        b.transfer("a", "b", 1);
        System.out.println("hidden ok");
    }
}
