package com.wisestay.scanner;

import android.Manifest;
import android.graphics.Color;
import android.opengl.GLSurfaceView;
import android.view.ViewGroup;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Config;
import com.google.ar.core.Session;
import java.time.Instant;
import java.util.UUID;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name="PhoneScanner", permissions={@Permission(alias="camera", strings={Manifest.permission.CAMERA})})
public class PhoneScannerPlugin extends Plugin implements CaptureRenderer.Listener {
    private Session session;
    private GLSurfaceView surface;
    private CaptureRenderer renderer;
    private String sessionId="",projectId="",capturedAt="";
    private final ExecutorService storage=Executors.newSingleThreadExecutor();
    private final AtomicBoolean checkpointPending=new AtomicBoolean(false);
    private boolean starting=false;
    @PluginMethod public void getCapabilities(PluginCall call) {
        ArCoreApk.Availability availability=ArCoreApk.getInstance().checkAvailability(getContext());boolean available=availability.isSupported() || availability.isTransient();
        JSObject result=new JSObject();result.put("platform","android");result.put("available",available);result.put("support",available?"needs-check":"unsupported");result.put("reason",available?"ARCore may be available. Installation, camera permission and Depth support are checked when you start.":"Google Play Services for AR is unsupported on this device.");result.put("source","arcore-depth");result.put("canPause",true);call.resolve(result);
    }
    @PluginMethod public void start(PluginCall call) {
        getActivity().runOnUiThread(()->{
            if(surface!=null||starting){call.reject("A capture is already active.","BUSY");return;}
            try{UUID.fromString(call.getString("sessionId",""));UUID.fromString(call.getString("projectId",""));}catch(Exception error){call.reject("Invalid capture identifiers.");return;}
            if(getPermissionState("camera")!=PermissionState.GRANTED){starting=true;requestPermissionForAlias("camera",call,"cameraPermission");return;}begin(call);
        });
    }
    @PermissionCallback private void cameraPermission(PluginCall call){starting=false;if(getPermissionState("camera")!=PermissionState.GRANTED){call.reject("Camera permission was denied. Enable it in system settings before scanning.","PERMISSION_DENIED");return;}getActivity().runOnUiThread(()->begin(call));}
    private void begin(PluginCall call) {
        starting=true;
        try {
            if(ArCoreApk.getInstance().requestInstall(getActivity(),true)==ArCoreApk.InstallStatus.INSTALL_REQUESTED){starting=false;call.reject("Finish installing Google Play Services for AR, return here and tap Start again.","ARCORE_INSTALL");return;}
            session=new Session(getContext());if(!session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)){session.close();session=null;starting=false;call.reject("This phone does not support ARCore Depth. Use reference photos or import a model.","UNSUPPORTED_DEPTH");return;}
            Config config=new Config(session);config.setDepthMode(Config.DepthMode.AUTOMATIC);config.setUpdateMode(Config.UpdateMode.LATEST_CAMERA_IMAGE);config.setLightEstimationMode(Config.LightEstimationMode.DISABLED);config.setCloudAnchorMode(Config.CloudAnchorMode.DISABLED);session.configure(config);
            sessionId=call.getString("sessionId");projectId=call.getString("projectId");capturedAt=Instant.now().toString();
            surface=new GLSurfaceView(getContext());surface.setEGLContextClientVersion(2);surface.setPreserveEGLContextOnPause(true);renderer=new CaptureRenderer(getActivity(),session,"detail".equals(call.getString("quality")),this);surface.setRenderer(renderer);surface.setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
            ViewGroup parent=(ViewGroup)bridge.getWebView().getParent();int index=parent.indexOfChild(bridge.getWebView());parent.addView(surface,index,new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT));bridge.getWebView().setBackgroundColor(Color.TRANSPARENT);
            session.resume();surface.onResume();starting=false;call.resolve();
        } catch(Exception error){starting=false;detach();call.reject("Native capture could not start: "+error.getClass().getSimpleName()+". Check ARCore installation and camera availability.","CAPTURE_START_FAILED");}
    }
    @PluginMethod public void pause(PluginCall call){getActivity().runOnUiThread(()->{if(surface==null){call.reject("No capture is active.");return;}pauseNative();call.resolve();});}
    @PluginMethod public void resume(PluginCall call){getActivity().runOnUiThread(()->{if(session==null||renderer==null||renderer.map.capacityReached){call.reject("Save this capture and start a new section.");return;}try{session.resume();renderer.running=true;renderer.paused=false;surface.onResume();call.resolve();}catch(Exception error){call.reject("The camera cannot resume. Save the partial scan.");}});}
    private void pauseNative(){if(surface==null||renderer==null)return;surface.onPause();renderer.paused=true;renderer.running=false;if(session!=null)session.pause();checkpoint(renderer.map.snapshot());progress(renderer);}
    @Override protected void handleOnPause(){getActivity().runOnUiThread(this::pauseNative);}
    @Override protected void handleOnResume(){/* Deliberate Resume is required. A backgrounded app does not silently reopen the camera. */}
    @PluginMethod public void stop(PluginCall call){getActivity().runOnUiThread(()->{if(renderer==null||surface==null){call.reject("No capture is active.","NO_CAPTURE");return;}surface.onPause();renderer.running=false;renderer.paused=true;VoxelMap.Mesh mesh=renderer.map.snapshot();JSObject metadata=metadata(mesh);String id=sessionId;detach();storage.execute(()->{try{new CaptureStore(getContext()).save(id,mesh,metadata);call.resolve(metadata);}catch(Exception error){call.reject(error.getMessage(),"SAVE_FAILED");}});});}
    @PluginMethod public void cancel(PluginCall call){getActivity().runOnUiThread(()->{String id=sessionId;detach();storage.execute(()->{try{if(!id.isEmpty())new CaptureStore(getContext()).discard(id);call.resolve();}catch(Exception error){call.reject(error.getMessage());}});});}
    @PluginMethod public void getRecoveries(PluginCall call){storage.execute(()->{try{JSObject value=new JSObject();value.put("results",new CaptureStore(getContext()).recoveries());call.resolve(value);}catch(Exception error){call.reject("Private recovery storage could not be read.");}});}
    @PluginMethod public void readChunk(PluginCall call){String id=call.getString("sessionId");Integer vo=call.getInt("vertexOffset"),vc=call.getInt("vertexCount"),io=call.getInt("indexOffset"),ic=call.getInt("indexCount");if(id==null||vo==null||vc==null||io==null||ic==null){call.reject("Missing scan chunk parameters.");return;}storage.execute(()->{try{call.resolve(new CaptureStore(getContext()).chunk(id,vo,vc,io,ic));}catch(Exception error){call.reject(error.getMessage());}});}
    @PluginMethod public void discard(PluginCall call){String id=call.getString("sessionId");if(id==null){call.reject("Missing capture identifier.");return;}storage.execute(()->{try{new CaptureStore(getContext()).discard(id);call.resolve();}catch(Exception error){call.reject(error.getMessage());}});}
    private void detach(){if(surface!=null){surface.onPause();ViewGroup parent=(ViewGroup)surface.getParent();if(parent!=null)parent.removeView(surface);surface=null;}if(session!=null){session.pause();session.close();session=null;}if(bridge.getWebView()!=null)bridge.getWebView().setBackgroundColor(Color.rgb(247,248,243));}
    private JSObject metadata(VoxelMap.Mesh mesh){JSObject value=new JSObject();value.put("sessionId",sessionId);value.put("projectId",projectId);value.put("source","arcore-depth");value.put("vertices",mesh.positions.length/3);value.put("indices",mesh.indices.length);value.put("elapsedMs",Math.min(android.os.SystemClock.elapsedRealtime()-renderer.started,86400000L));value.put("capturedAt",capturedAt);JSArray warnings=new JSArray();warnings.put("ARCore raw-depth geometry is approximate. Low-confidence pixels are excluded; missing surfaces remain missing.");warnings.put("Camera colours are sampled when available; this is not a photographic texture atlas. Separate sessions require manual alignment.");if(!renderer.message.isEmpty())warnings.put(renderer.message);value.put("warnings",warnings);return value;}
    @Override public void checkpoint(VoxelMap.Mesh mesh){if(mesh.positions.length==0||!checkpointPending.compareAndSet(false,true))return;JSObject metadata=metadata(mesh);String id=sessionId;storage.execute(()->{try{new CaptureStore(getContext()).save(id,mesh,metadata);}catch(Exception error){if(renderer!=null)renderer.message="Recovery checkpoint failed. Save this scan before leaving the app.";}finally{checkpointPending.set(false);}});}
    @Override public void progress(CaptureRenderer r){JSObject value=new JSObject();value.put("sessionId",sessionId);value.put("vertices",r.map.vertexCount());value.put("triangles",r.map.triangleCount());value.put("frames",r.frames);value.put("elapsedMs",android.os.SystemClock.elapsedRealtime()-r.started);value.put("tracking",r.tracking);value.put("paused",r.paused);value.put("budgetReached",r.map.capacityReached);ArrayList<Float> preview=new ArrayList<>();for(float coordinate:r.map.preview(2000))preview.add(coordinate);value.put("preview",new JSArray(preview));value.put("message",r.message);notifyListeners("progress",value);}
    @Override protected void handleOnDestroy(){getActivity().runOnUiThread(()->{pauseNative();detach();storage.shutdown();});}
}
