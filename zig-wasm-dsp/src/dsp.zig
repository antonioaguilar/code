//! DSP kernels and buffers. Nothing here knows about WebAssembly: every function that
//! allocates takes an `Allocator`, so the same code runs natively under the test allocator.
const std = @import("std");
const Allocator = std.mem.Allocator;

/// Gain + one-pole low-pass, in place. `state` keeps the filter memory between calls.
/// Never allocates: safe to call from a real-time callback.
pub fn process(buf: []f32, state: *f32, gain: f32, coeff: f32) void {
    var z = state.*;
    for (buf) |*s| {
        z += coeff * (s.* * gain - z);
        s.* = z;
    }
    state.* = z;
}

/// A multichannel bank of buffers and filter states, allocated once at setup.
pub const Bank = struct {
    buffers: [][]f32,
    states: []f32,

    pub fn init(gpa: Allocator, channels: usize, frames: usize) Allocator.Error!Bank {
        const buffers = try gpa.alloc([]f32, channels);
        errdefer gpa.free(buffers);

        var done: usize = 0;
        errdefer for (buffers[0..done]) |buf| gpa.free(buf);
        for (buffers) |*buf| {
            buf.* = try gpa.alloc(f32, frames);
            @memset(buf.*, 0);
            done += 1;
        }

        const states = try gpa.alloc(f32, channels);
        @memset(states, 0);
        return .{ .buffers = buffers, .states = states };
    }

    pub fn deinit(bank: Bank, gpa: Allocator) void {
        for (bank.buffers) |buf| gpa.free(buf);
        gpa.free(bank.buffers);
        gpa.free(bank.states);
    }

    pub fn processAll(bank: Bank, gain: f32, coeff: f32) void {
        for (bank.buffers, bank.states) |buf, *state| process(buf, state, gain, coeff);
    }
};
