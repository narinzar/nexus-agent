package bank;

public class InsufficientFundsException extends RuntimeException {
    public InsufficientFundsException(String account, long requested, long available) {
        super("account " + account + ": requested " + requested + ", available " + available);
    }
}
