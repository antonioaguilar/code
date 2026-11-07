//! Native tests. `std.testing.allocator` fails any test that leaks, and
//! `checkAllAllocationFailures` re-runs a test failing each allocation in turn,
//! so every error path is checked for leaks too.
const std = @import("std");
const testing = std.testing;
const dsp = @import("dsp.zig");
const CountingAllocator = @import("CountingAllocator.zig");

test "process applies gain and converges to the input level" {
    var buf: [128]f32 = @splat(1);
    var state: f32 = 0;
    dsp.process(&buf, &state, 0.5, 0.1);
    try testing.expectApproxEqAbs(@as(f32, 0.05), buf[0], 1e-6);
    try testing.expectApproxEqAbs(@as(f32, 0.5), buf[127], 1e-4);
    try testing.expectEqual(buf[127], state);
}

test "Bank init/deinit leaks nothing" {
    const bank = try dsp.Bank.init(testing.allocator, 2, 128);
    defer bank.deinit(testing.allocator);
    bank.processAll(0.8, 0.1);
}

fn initAndDeinitBank(gpa: std.mem.Allocator) !void {
    const bank = try dsp.Bank.init(gpa, 4, 128);
    bank.deinit(gpa);
}

test "Bank.init frees everything when any allocation fails" {
    try testing.checkAllAllocationFailures(testing.allocator, initAndDeinitBank, .{});
}

test "CountingAllocator tracks live allocations" {
    var counting: CountingAllocator = .{ .child = testing.allocator };
    const gpa = counting.allocator();
    const a = try gpa.alloc(f32, 128);
    const b = try gpa.alloc(f32, 1);
    try testing.expectEqual(@as(usize, 2), counting.live_allocs);
    try testing.expectEqual(@as(usize, 129 * @sizeOf(f32)), counting.live_bytes);
    gpa.free(a);
    gpa.free(b);
    try testing.expectEqual(@as(usize, 0), counting.live_allocs);
    try testing.expectEqual(@as(usize, 0), counting.live_bytes);
}
