import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;
import java.io.File;
import java.io.PrintWriter;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

public class DumpEkosfera extends GhidraScript {
    private static final Pattern NAMES = Pattern.compile(
        "EsRpcMaster|Ekosfera|EsChannelIoUart|EsCRC|EsEko", Pattern.CASE_INSENSITIVE);
    private final Set<String> dumped = new TreeSet<>();
    private PrintWriter out;
    private DecompInterface decompiler;

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 1) throw new IllegalArgumentException("Output path is required");
        out = new PrintWriter(new File(args[0]), "UTF-8");
        decompiler = new DecompInterface();
        decompiler.openProgram(currentProgram);

        FunctionIterator functions = currentProgram.getFunctionManager().getFunctions(true);
        while (functions.hasNext()) {
            Function function = functions.next();
            if (NAMES.matcher(function.getName(true)).find()) dump(function, 0);
        }

        dumpVtable("EsRpcMaster::vftable");
        dumpVtable("EsChannelIoUart::vftable");
        dumpVtable("EsCRC8::vftable");
        dumpVtable("EsCRC16_CCIITT::vftable");
        dumpVtable("EsCRC32_IEEE802_3::vftable");

        long[] stringAddresses = {
            0x1045ba08L, 0x1045ba3aL, 0x1045d020L, 0x1045d130L,
            0x1045d150L, 0x1045d1c0L, 0x1045d2f8L
        };
        for (long value : stringAddresses) {
            Address target = toAddr(value);
            ReferenceIterator refs = currentProgram.getReferenceManager().getReferencesTo(target);
            while (refs.hasNext()) {
                Reference ref = refs.next();
                Function function = getFunctionContaining(ref.getFromAddress());
                if (function != null) dump(function, 2);
            }
        }

        out.close();
        decompiler.dispose();
        println("Saved Ekosfera decompilation to " + args[0]);
    }

    private void dumpVtable(String name) throws Exception {
        SymbolIterator symbols = currentProgram.getSymbolTable().getAllSymbols(true);
        while (symbols.hasNext()) {
            Symbol symbol = symbols.next();
            if (!symbol.getName(true).equals(name)) continue;
            out.println("\n\nVTABLE " + name + " @ " + symbol.getAddress());
            for (int index = 0; index < 128; index++) {
                Address entry = symbol.getAddress().add(index * 4L);
                int raw = currentProgram.getMemory().getInt(entry);
                if (raw == 0) break;
                Function function = getFunctionAt(toAddr(Integer.toUnsignedLong(raw)));
                if (function == null) continue;
                out.println("  [" + index + "] " + function.getName(true) + " @ " + function.getEntryPoint());
                dump(function, 0);
            }
        }
    }

    private void dump(Function function, int callerDepth) {
        if (function == null || dumped.contains(function.getEntryPoint().toString())) return;
        dumped.add(function.getEntryPoint().toString());
        out.println("\n============================================================");
        out.println(function.getName(true) + " @ " + function.getEntryPoint());
        out.println("============================================================");
        DecompileResults result = decompiler.decompileFunction(function, 90, monitor);
        if (result.decompileCompleted() && result.getDecompiledFunction() != null) {
            out.println(result.getDecompiledFunction().getC());
        } else {
            out.println("DECOMPILATION FAILED: " + result.getErrorMessage());
        }
        if (callerDepth == 0) return;
        ReferenceIterator callers = currentProgram.getReferenceManager().getReferencesTo(function.getEntryPoint());
        while (callers.hasNext()) {
            Reference ref = callers.next();
            if (!ref.getReferenceType().isCall()) continue;
            dump(getFunctionContaining(ref.getFromAddress()), callerDepth - 1);
        }
    }
}
