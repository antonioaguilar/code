//! Wraps an allocator and counts live allocations and bytes, so the JavaScript host can
//! assert that it freed everything it allocated. Used in Debug builds only.
const std = @import("std");
const Allocator = std.mem.Allocator;
const Alignment = std.mem.Alignment;
const CountingAllocator = @This();

child: Allocator,
live_allocs: usize = 0,
live_bytes: usize = 0,

pub fn allocator(self: *CountingAllocator) Allocator {
    return .{ .ptr = self, .vtable = &vtable };
}

const vtable: Allocator.VTable = .{ .alloc = alloc, .resize = resize, .remap = remap, .free = free };

fn alloc(ctx: *anyopaque, len: usize, alignment: Alignment, ret_addr: usize) ?[*]u8 {
    const self: *CountingAllocator = @ptrCast(@alignCast(ctx));
    const ptr = self.child.rawAlloc(len, alignment, ret_addr) orelse return null;
    self.live_allocs += 1;
    self.live_bytes += len;
    return ptr;
}

fn resize(ctx: *anyopaque, memory: []u8, alignment: Alignment, new_len: usize, ret_addr: usize) bool {
    const self: *CountingAllocator = @ptrCast(@alignCast(ctx));
    if (!self.child.rawResize(memory, alignment, new_len, ret_addr)) return false;
    self.live_bytes = self.live_bytes - memory.len + new_len;
    return true;
}

fn remap(ctx: *anyopaque, memory: []u8, alignment: Alignment, new_len: usize, ret_addr: usize) ?[*]u8 {
    const self: *CountingAllocator = @ptrCast(@alignCast(ctx));
    const ptr = self.child.rawRemap(memory, alignment, new_len, ret_addr) orelse return null;
    self.live_bytes = self.live_bytes - memory.len + new_len;
    return ptr;
}

fn free(ctx: *anyopaque, memory: []u8, alignment: Alignment, ret_addr: usize) void {
    const self: *CountingAllocator = @ptrCast(@alignCast(ctx));
    self.child.rawFree(memory, alignment, ret_addr);
    self.live_allocs -= 1;
    self.live_bytes -= memory.len;
}
