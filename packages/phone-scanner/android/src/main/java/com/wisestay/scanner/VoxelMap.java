package com.wisestay.scanner;

import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;

/** Pure-Java bounded incremental surface fusion; deliberately independent of ARCore and UI. */
public final class VoxelMap {
    public static final class Mesh {
        public final float[] positions, colors;
        public final int[] indices;
        public Mesh(float[] positions, float[] colors, int[] indices) { this.positions = positions; this.colors = colors; this.indices = indices; }
    }
    private final float voxel;
    private final int maxVertices, maxTriangles;
    private final float[] positions, colors;
    private final int[] weights, triangles;
    private final HashMap<Long, Integer> cells = new HashMap<>();
    private final HashSet<Long> faces = new HashSet<>();
    private int vertices = 0, triangleCount = 0;
    public boolean capacityReached = false;
    public VoxelMap(float voxel, int maxVertices, int maxTriangles) {
        if (!(voxel >= .005f && voxel <= .2f) || maxVertices < 1 || maxVertices > 500000 || maxTriangles < 0 || maxTriangles > 1000000) throw new IllegalArgumentException("Invalid reconstruction budget");
        this.voxel = voxel; this.maxVertices = maxVertices; this.maxTriangles = maxTriangles;
        positions = new float[maxVertices * 3]; colors = new float[maxVertices * 3]; weights = new int[maxVertices]; triangles = new int[maxTriangles * 3];
    }
    public int vertexCount() { return vertices; }
    public int triangleCount() { return triangleCount; }
    public int point(float x, float y, float z, float r, float g, float b) {
        if (!Float.isFinite(x) || !Float.isFinite(y) || !Float.isFinite(z) || Math.abs(x) > 1000 || Math.abs(y) > 1000 || Math.abs(z) > 1000 || !Float.isFinite(r) || !Float.isFinite(g) || !Float.isFinite(b)) return -1;
        int qx = (int) Math.floor(x / voxel), qy = (int) Math.floor(y / voxel), qz = (int) Math.floor(z / voxel);
        long key = (((long) qx & 0x1fffffL) << 42) | (((long) qy & 0x1fffffL) << 21) | ((long) qz & 0x1fffffL);
        Integer existing = cells.get(key); int id;
        if (existing == null) { if (vertices >= maxVertices) { capacityReached = true; return -1; } id = vertices++; cells.put(key, id); }
        else id = existing;
        float w = 1f / (Math.min(weights[id], 30) + 1); weights[id] = Math.min(weights[id] + 1, 31);
        float[] p = {x, y, z}, c = {r, g, b};
        for (int k = 0; k < 3; k++) { positions[id * 3 + k] += (p[k] - positions[id * 3 + k]) * w; colors[id * 3 + k] += (Math.max(0, Math.min(1, c[k])) - colors[id * 3 + k]) * w; }
        return id;
    }
    private float distanceSquared(int a, int b) { float d = 0; for (int k = 0; k < 3; k++) { float v = positions[a * 3 + k] - positions[b * 3 + k]; d += v * v; } return d; }
    public void triangle(int a, int b, int c) {
        if (a < 0 || b < 0 || c < 0 || a >= vertices || b >= vertices || c >= vertices || a == b || b == c || a == c || triangleCount >= maxTriangles) return;
        if (distanceSquared(a,b) > .0625f || distanceSquared(a,c) > .0625f || distanceSquared(b,c) > .0625f) return;
        int low = Math.min(a, Math.min(b,c)), high = Math.max(a, Math.max(b,c)), middle = a + b + c - low - high;
        long key = ((long)low << 38) | ((long)middle << 19) | (long)high;
        if (faces.add(key)) { triangles[triangleCount * 3] = a; triangles[triangleCount * 3 + 1] = b; triangles[triangleCount * 3 + 2] = c; triangleCount++; }
    }
    public Mesh snapshot() { return new Mesh(Arrays.copyOf(positions, vertices * 3), Arrays.copyOf(colors, vertices * 3), Arrays.copyOf(triangles, triangleCount * 3)); }
    public float[] preview(int limit) { int step = Math.max(1, (int)Math.ceil(vertices / (double)limit)), count = (vertices + step - 1) / step; float[] result = new float[count * 3]; int n = 0; for (int i = 0; i < vertices; i += step) { System.arraycopy(positions, i * 3, result, n * 3, 3); n++; } return result; }
    public static float[] unproject(float x, float y, float depth, float fx, float fy, float cx, float cy, float[] cameraToWorld) {
        if (depth <= 0 || !Float.isFinite(depth) || fx <= 0 || fy <= 0 || cameraToWorld.length != 16) throw new IllegalArgumentException("Invalid depth sample");
        float px = (x - cx) * depth / fx, py = -(y - cy) * depth / fy, pz = -depth;
        return new float[] { cameraToWorld[0]*px + cameraToWorld[4]*py + cameraToWorld[8]*pz + cameraToWorld[12], cameraToWorld[1]*px + cameraToWorld[5]*py + cameraToWorld[9]*pz + cameraToWorld[13], cameraToWorld[2]*px + cameraToWorld[6]*py + cameraToWorld[10]*pz + cameraToWorld[14] };
    }
}
