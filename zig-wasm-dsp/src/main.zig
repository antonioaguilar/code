//! The WebAssembly ABI: numbers and pointers into linear memory, nothing else.
//! Release builds allocate straight from `std.heap.wasm_allocator` (BrkAllocator).
//! Debug builds wrap it in a counter and export `live_allocs` / `live_bytes` for leak checks.
const std = @import("std");
const builtin = @import("builtin");
const dsp = @import("dsp.zig");
const CountingAllocator = @import("CountingAllocator.zig");

const track_leaks = builtin.mode == .debug;
var counting: CountingAllocator = .{ .child = std.heap.wasm_allocator };

fn gpa() std.mem.Allocator {
    return if (track_leaks) counting.allocator() else std.heap.wasm_allocator;
}

export fn alloc_f32(len: usize) ?[*]f32 {
    const buf = gpa().alloc(f32, len) catch return null;
    return buf.ptr;
}

export fn free_f32(ptr: [*]f32, len: usize) void {
    gpa().free(ptr[0..len]);
}

/// Gain + one-pole low-pass, in place. No allocation on this path.
export fn process(buf: [*]f32, len: usize, state: *f32, gain: f32, coeff: f32) void {
    dsp.process(buf[0..len], state, gain, coeff);
}

fn liveAllocs() callconv(.c) usize {
    return counting.live_allocs;
}

fn liveBytes() callconv(.c) usize {
    return counting.live_bytes;
}

comptime {
    if (track_leaks) {
        @export(&liveAllocs, .{ .name = "live_allocs" });
        @export(&liveBytes, .{ .name = "live_bytes" });
    }
}
