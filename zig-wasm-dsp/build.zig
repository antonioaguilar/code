const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{ .preferred_optimize_mode = .small });
    const stack_kib = b.option(u32, "stack-kib", "Wasm stack size in KiB (default: 64)") orelse 64;

    // `zig build` / `zig build --release`: the freestanding module.
    const wasm = b.addExecutable(.{
        .name = "dsp",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = b.resolveTargetQuery(.{ .cpu_arch = .wasm32, .os_tag = .freestanding }),
            .optimize = optimize,
        }),
    });
    wasm.entry = .disabled; // a library of exports, not a program
    wasm.rdynamic = true; // export every `export fn`
    wasm.stack_size = stack_kib * 1024;
    b.installArtifact(wasm);

    // `zig build test`: the same code, natively, under the leak-checking test allocator.
    const tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/tests.zig"),
            .target = b.graph.host,
            .optimize = optimize,
        }),
    });
    b.step("test", "Run unit and leak tests natively").dependOn(&b.addRunArtifact(tests).step);
}
