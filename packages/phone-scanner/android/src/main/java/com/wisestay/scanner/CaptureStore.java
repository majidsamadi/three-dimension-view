package com.wisestay.scanner;

import android.content.Context;
import android.util.AtomicFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.util.UUID;
import org.json.JSONException;

/** Snapshots stay in app-private, no-backup storage. No external-storage permission. */
final class CaptureStore {
    private final File directory;
    CaptureStore(Context context) throws IOException {
        directory = new File(context.getNoBackupFilesDir(), "three-dimension-capture");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Private capture storage is unavailable.");
    }
    private File file(String id, String suffix) { if (!UUID.fromString(id).toString().equalsIgnoreCase(id)) throw new IllegalArgumentException("Invalid capture identifier."); return new File(directory, id.toLowerCase() + "." + suffix); }
    private void atomic(File file, byte[] bytes) throws IOException {
        AtomicFile storage = new AtomicFile(file); FileOutputStream stream = storage.startWrite();
        try { stream.write(bytes); storage.finishWrite(stream); } catch (IOException error) { storage.failWrite(stream); throw error; }
    }
    void save(String id, VoxelMap.Mesh mesh, JSObject metadata) throws IOException {
        int vertices = mesh.positions.length / 3;
        if (vertices < 1 || vertices > 500000 || mesh.positions.length % 3 != 0 || mesh.colors.length != mesh.positions.length || mesh.indices.length > 3000000 || mesh.indices.length % 3 != 0) throw new IOException("No valid geometry was captured. Move slowly in better light and try again.");
        ByteBuffer data = ByteBuffer.allocate(20 + vertices * 24 + mesh.indices.length * 4).order(ByteOrder.LITTLE_ENDIAN);
        data.putInt(0x47443357).putInt(1).putInt(vertices).putInt(mesh.indices.length).putInt(1);
        for (float v : mesh.positions) { if (!Float.isFinite(v) || Math.abs(v) > 100000) throw new IOException("Invalid scan coordinates."); data.putFloat(v); }
        for (float c : mesh.colors) { if (!Float.isFinite(c) || c < 0 || c > 1) throw new IOException("Invalid scan colour."); data.putFloat(c); }
        for (int index : mesh.indices) { if (index < 0 || index >= vertices) throw new IOException("Invalid scan triangle."); data.putInt(index); }
        atomic(file(id,"mesh"), data.array()); atomic(file(id,"json"), metadata.toString().getBytes(StandardCharsets.UTF_8));
    }
    JSArray recoveries() throws Exception {
        JSArray results = new JSArray(); File[] files = directory.listFiles((dir, name) -> name.endsWith(".json")); if (files == null) return results;
        for (File item : files) {
            try { if (item.length() > 32768) continue; JSObject metadata = new JSObject(readMetadata(item)); String id = metadata.getString("sessionId"); try (RandomAccessFile geometry = new RandomAccessFile(file(id,"mesh"), "r")) { int[] counts = header(geometry); metadata.put("vertices", counts[0]); metadata.put("indices", counts[1]); } results.put(metadata); }
            catch (Exception ignored) { /* Do not advertise missing/corrupt data as a recoverable capture. Other files remain available. */ }
        }
        return results;
    }
    /** Bounded UTF-8 read using Android API-26-compatible APIs, including AtomicFile crash recovery. */
    private String readMetadata(File item) throws IOException {
        try (FileInputStream input = new AtomicFile(item).openRead(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[4096];
            int count;
            while ((count = input.read(chunk)) != -1) {
                if (output.size() + count > 32768) throw new IOException("Capture metadata exceeds its size limit.");
                output.write(chunk, 0, count);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }
    private int[] header(RandomAccessFile file) throws IOException {
        if (file.length() < 20 || file.length() > 64L * 1024 * 1024) throw new IOException("Invalid scan snapshot size.");
        byte[] header = new byte[20]; file.readFully(header); ByteBuffer b = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN);
        int magic=b.getInt(), version=b.getInt(), vc=b.getInt(), ic=b.getInt(), flags=b.getInt();
        if (magic != 0x47443357 || version != 1 || vc < 1 || vc > 500000 || ic < 0 || ic > 3000000 || ic % 3 != 0 || flags != 1 || file.length() != 20L + vc * 24L + ic * 4L) throw new IOException("The scan snapshot is incomplete or unsupported.");
        return new int[] {vc,ic};
    }
    JSObject chunk(String id, int vo, int vc, int io, int ic) throws IOException {
        if (vo < 0 || vc < 0 || vc > 4096 || io < 0 || ic < 0 || ic > 12288) throw new IOException("Invalid scan chunk range.");
        try (RandomAccessFile file = new RandomAccessFile(file(id,"mesh"),"r")) {
            int[] counts = header(file); if (vo > counts[0] || vc > counts[0]-vo || io > counts[1] || ic > counts[1]-io) throw new IOException("The scan chunk exceeds the saved capture.");
            JSArray positions = floats(file, 20L + vo*12L, vc*3), colors = floats(file,20L + counts[0]*12L + vo*12L,vc*3), indices = new JSArray();
            byte[] bytes = new byte[ic*4]; file.seek(20L+counts[0]*24L+io*4L); file.readFully(bytes); ByteBuffer b=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN); while(b.hasRemaining()) indices.put(b.getInt());
            JSObject result = new JSObject(); result.put("positions",positions); result.put("colors",colors); result.put("indices",indices); return result;
        }
    }
    private JSArray floats(RandomAccessFile file, long offset, int length) throws IOException {
        byte[] bytes = new byte[length * 4];
        file.seek(offset);
        file.readFully(bytes);
        ByteBuffer data = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        JSArray result = new JSArray();
        try {
            while (data.hasRemaining()) {
                float value = data.getFloat();
                if (!Float.isFinite(value)) throw new IOException("The saved scan contains invalid numeric data.");
                result.put((double) value);
            }
        } catch (JSONException error) {
            throw new IOException("The saved scan cannot be represented safely.", error);
        }
        return result;
    }
    void discard(String id) throws IOException { for(String suffix: new String[]{"json","mesh"}) { File path=file(id,suffix); if(path.exists() && !path.delete()) throw new IOException("The recovery copy could not be removed."); new AtomicFile(path).delete(); } }
}
