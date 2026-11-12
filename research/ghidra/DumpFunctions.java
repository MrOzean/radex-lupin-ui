import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import java.io.File;
import java.io.PrintWriter;

public class DumpFunctions extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length < 2) throw new IllegalArgumentException("Usage: output.txt address...");
        PrintWriter out = new PrintWriter(new File(args[0]), "UTF-8");
        DecompInterface decompiler = new DecompInterface();
        decompiler.openProgram(currentProgram);
        for (int index = 1; index < args.length; index++) {
            Function function = getFunctionAt(toAddr(Long.decode(args[index])));
            if (function == null) {
                out.println("No function at " + args[index]);
                continue;
            }
            out.println("\n============================================================");
            out.println(function.getName(true) + " @ " + function.getEntryPoint());
            out.println("============================================================");
            DecompileResults result = decompiler.decompileFunction(function, 120, monitor);
            out.println(result.decompileCompleted() && result.getDecompiledFunction() != null
                ? result.getDecompiledFunction().getC() : result.getErrorMessage());
        }
        out.close();
        decompiler.dispose();
    }
}
