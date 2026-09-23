package com.wisestay.scanner;

import android.app.Activity;
import android.media.Image;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.opengl.Matrix;
import android.os.SystemClock;
import com.google.ar.core.Camera;
import com.google.ar.core.CameraIntrinsics;
import com.google.ar.core.Coordinates2d;
import com.google.ar.core.Frame;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;
import com.google.ar.core.exceptions.NotYetAvailableException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.Arrays;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

final class CaptureRenderer implements GLSurfaceView.Renderer {
    interface Listener { void progress(CaptureRenderer r); void checkpoint(VoxelMap.Mesh mesh); }
    final VoxelMap map;
    volatile boolean paused=false, running=true;
    String tracking="Initializing tracking", message="";
    int frames=0;
    final long started=SystemClock.elapsedRealtime();
    private final Session session;
    private final Activity activity;
    private final Listener listener;
    private long sampleAt=0,eventAt=0,checkpointAt=0,lastDepthTimestamp=0,lastDepthAt=started;
    private int cameraTexture,backgroundProgram,pointProgram,width=1,height=1,rotation=-1;
    private FloatBuffer cloud = floats(new float[0]);
    private final FloatBuffer quad = floats(new float[]{-1,-1, 1,-1, -1,1, 1,1});
    private final FloatBuffer uv = floats(new float[8]);
    private final float[] projection=new float[16],view=new float[16],mvp=new float[16];
    CaptureRenderer(Activity activity,Session session,boolean detail,Listener listener) { this.activity=activity;this.session=session;this.listener=listener;map=new VoxelMap(detail?.015f:.03f,detail?200000:100000,detail?300000:150000); }
    private static FloatBuffer floats(float[] data) { FloatBuffer buffer=ByteBuffer.allocateDirect(data.length*4).order(ByteOrder.nativeOrder()).asFloatBuffer();buffer.put(data).position(0);return buffer; }
    @Override public void onSurfaceCreated(GL10 gl,EGLConfig config) {
        int[] textures=new int[1];GLES20.glGenTextures(1,textures,0);cameraTexture=textures[0];GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,cameraTexture);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_MIN_FILTER,GLES20.GL_LINEAR);GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_MAG_FILTER,GLES20.GL_LINEAR);GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_WRAP_S,GLES20.GL_CLAMP_TO_EDGE);GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,GLES20.GL_TEXTURE_WRAP_T,GLES20.GL_CLAMP_TO_EDGE);
        backgroundProgram=program("attribute vec2 aPosition;attribute vec2 aUV;varying vec2 vUV;void main(){gl_Position=vec4(aPosition,0.,1.);vUV=aUV;}","#extension GL_OES_EGL_image_external : require\nprecision mediump float;uniform samplerExternalOES camera;varying vec2 vUV;void main(){gl_FragColor=texture2D(camera,vUV);}");
        pointProgram=program("attribute vec3 aPosition;uniform mat4 mvp;void main(){gl_Position=mvp*vec4(aPosition,1.);gl_PointSize=3.;}","precision mediump float;void main(){gl_FragColor=vec4(.13,.96,.63,.9);}");
    }
    @Override public void onSurfaceChanged(GL10 gl,int width,int height) { this.width=width;this.height=height;rotation=-1;GLES20.glViewport(0,0,width,height); }
    @Override public void onDrawFrame(GL10 gl) {
        GLES20.glClearColor(.07f,.14f,.1f,1);GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT|GLES20.GL_DEPTH_BUFFER_BIT);
        if(!running) return;
        try {
            int currentRotation=activity.getWindowManager().getDefaultDisplay().getRotation();if(currentRotation!=rotation){rotation=currentRotation;session.setDisplayGeometry(rotation,width,height);}
            session.setCameraTextureName(cameraTexture);Frame frame=session.update();Camera camera=frame.getCamera();
            if(frame.getTimestamp()!=0){quad.position(0);uv.position(0);frame.transformCoordinates2d(Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES,quad,Coordinates2d.TEXTURE_NORMALIZED,uv);drawCamera();}
            long now=SystemClock.elapsedRealtime();
            if(now-eventAt>=400){eventAt=now;listener.progress(this);}
            if(camera.getTrackingState()!=TrackingState.TRACKING){tracking="Tracking limited — move slowly in better light";return;}
            tracking=paused?"Paused":"Tracking real surfaces";
            camera.getProjectionMatrix(projection,0,.05f,50f);camera.getViewMatrix(view,0);Matrix.multiplyMM(mvp,0,projection,0,view,0);
            if(!paused && !map.capacityReached && now-sampleAt>=220){sampleAt=now;integrate(frame);}
            drawPoints();
            if(map.capacityReached){paused=true;message="Capture budget reached. Save this section, then start another section.";}
            if(!paused && now-lastDepthAt>15000) message="No usable depth for 15 seconds. Move sideways toward a well-lit textured area; no geometry is being invented.";
            if(now-checkpointAt>5000 && map.vertexCount()>0){checkpointAt=now;listener.checkpoint(map.snapshot());}
        } catch(NotYetAvailableException ignored){tracking="Waiting for camera / depth";}
        catch(Exception failure){paused=true;running=false;message="Capture paused: "+failure.getClass().getSimpleName()+". Save the partial scan or restart capture.";listener.checkpoint(map.snapshot());listener.progress(this);}
    }
    private void integrate(Frame frame) throws Exception {
        try(Image depth=frame.acquireRawDepthImage16Bits();Image confidence=frame.acquireRawDepthConfidenceImage()) {
            if(depth.getTimestamp()==lastDepthTimestamp)return;lastDepthTimestamp=depth.getTimestamp();
            int width=depth.getWidth(),height=depth.getHeight(),step=Math.max(2,(int)Math.ceil(width/64.0)),columns=(width+step-1)/step,rows=(height+step-1)/step;
            Image.Plane dp=depth.getPlanes()[0],cp=confidence.getPlanes()[0];ByteBuffer depths=dp.getBuffer().order(ByteOrder.LITTLE_ENDIAN),conf=cp.getBuffer();
            CameraIntrinsics intrinsics=frame.getCamera().getTextureIntrinsics();float[] focal=intrinsics.getFocalLength(),principal=intrinsics.getPrincipalPoint();int[] dimensions=intrinsics.getImageDimensions();
            float fx=focal[0]*width/dimensions[0],fy=focal[1]*height/dimensions[1],cx=principal[0]*width/dimensions[0],cy=principal[1]*height/dimensions[1];float[] pose=new float[16];frame.getCamera().getPose().toMatrix(pose,0);
            int[] ids=new int[columns*rows];Arrays.fill(ids,-1);
            FloatBuffer textureCoordinates=floats(new float[columns*rows*2]), imageCoordinates=floats(new float[columns*rows*2]);
            for(int y=0;y<height;y+=step)for(int x=0;x<width;x+=step){textureCoordinates.put((x+.5f)/width);textureCoordinates.put((y+.5f)/height);}textureCoordinates.position(0);
            frame.transformCoordinates2d(Coordinates2d.TEXTURE_NORMALIZED,textureCoordinates,Coordinates2d.IMAGE_PIXELS,imageCoordinates);
            Image rgb=null;try{rgb=frame.acquireCameraImage();}catch(NotYetAvailableException ignored){/* Geometry is still valid without colour. */}
            try {
                int n=0,accepted=0;
                for(int y=0;y<height;y+=step)for(int x=0;x<width;x+=step){int index=n++;int confidenceValue=conf.get(y*cp.getRowStride()+x*cp.getPixelStride())&255;int mm=depths.getShort(y*dp.getRowStride()+x*dp.getPixelStride())&65535;if(confidenceValue<128||mm<150||mm>8000)continue;
                    float[] world=VoxelMap.unproject(x+.5f,y+.5f,mm*.001f,fx,fy,cx,cy,pose),color=colour(rgb,(int)imageCoordinates.get(index*2),(int)imageCoordinates.get(index*2+1));ids[index]=map.point(world[0],world[1],world[2],color[0],color[1],color[2]);accepted++;
                }
                for(int y=0;y<rows-1;y++)for(int x=0;x<columns-1;x++){int p=y*columns+x;map.triangle(ids[p],ids[p+columns],ids[p+1]);map.triangle(ids[p+1],ids[p+columns],ids[p+columns+1]);}
                if(accepted>0){lastDepthAt=SystemClock.elapsedRealtime();message="";}frames++;cloud=floats(map.preview(40000));
            } finally { if(rgb!=null)rgb.close(); }
        } catch(NotYetAvailableException ignored){tracking="Waiting for confident depth — move slowly sideways";}
    }
    private float[] colour(Image image,int x,int y) {
        if(image==null||x<0||y<0||x>=image.getWidth()||y>=image.getHeight()||image.getPlanes().length<3)return new float[]{.23f,.63f,.45f};
        Image.Plane[] p=image.getPlanes();float l=(p[0].getBuffer().get(y*p[0].getRowStride()+x*p[0].getPixelStride())&255)/255f;float cb=(p[1].getBuffer().get((y/2)*p[1].getRowStride()+(x/2)*p[1].getPixelStride())&255)/255f-.5f;float cr=(p[2].getBuffer().get((y/2)*p[2].getRowStride()+(x/2)*p[2].getPixelStride())&255)/255f-.5f;
        float[] result={l+1.402f*cr,l-.344136f*cb-.714136f*cr,l+1.772f*cb};for(int i=0;i<3;i++){float srgb=Math.max(0,Math.min(1,result[i]));result[i]=srgb<=.04045f?srgb/12.92f:(float)Math.pow((srgb+.055f)/1.055f,2.4);}return result;
    }
    private void drawCamera() { GLES20.glDisable(GLES20.GL_DEPTH_TEST);GLES20.glUseProgram(backgroundProgram);int p=GLES20.glGetAttribLocation(backgroundProgram,"aPosition"),t=GLES20.glGetAttribLocation(backgroundProgram,"aUV");quad.position(0);uv.position(0);GLES20.glVertexAttribPointer(p,2,GLES20.GL_FLOAT,false,0,quad);GLES20.glVertexAttribPointer(t,2,GLES20.GL_FLOAT,false,0,uv);GLES20.glEnableVertexAttribArray(p);GLES20.glEnableVertexAttribArray(t);GLES20.glActiveTexture(GLES20.GL_TEXTURE0);GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES,cameraTexture);GLES20.glUniform1i(GLES20.glGetUniformLocation(backgroundProgram,"camera"),0);GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP,0,4);GLES20.glDisableVertexAttribArray(p);GLES20.glDisableVertexAttribArray(t); }
    private void drawPoints() { if(cloud.capacity()==0)return;GLES20.glUseProgram(pointProgram);GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(pointProgram,"mvp"),1,false,mvp,0);int position=GLES20.glGetAttribLocation(pointProgram,"aPosition");cloud.position(0);GLES20.glVertexAttribPointer(position,3,GLES20.GL_FLOAT,false,0,cloud);GLES20.glEnableVertexAttribArray(position);GLES20.glDrawArrays(GLES20.GL_POINTS,0,cloud.capacity()/3);GLES20.glDisableVertexAttribArray(position); }
    private static int shader(int type,String source) { int shader=GLES20.glCreateShader(type);GLES20.glShaderSource(shader,source);GLES20.glCompileShader(shader);int[] status=new int[1];GLES20.glGetShaderiv(shader,GLES20.GL_COMPILE_STATUS,status,0);if(status[0]==0)throw new IllegalStateException("Native camera shader compilation failed.");return shader; }
    private static int program(String vertex,String fragment) { int vs=shader(GLES20.GL_VERTEX_SHADER,vertex),fs=shader(GLES20.GL_FRAGMENT_SHADER,fragment),program=GLES20.glCreateProgram();GLES20.glAttachShader(program,vs);GLES20.glAttachShader(program,fs);GLES20.glLinkProgram(program);GLES20.glDeleteShader(vs);GLES20.glDeleteShader(fs);int[] status=new int[1];GLES20.glGetProgramiv(program,GLES20.GL_LINK_STATUS,status,0);if(status[0]==0)throw new IllegalStateException("Native camera shader link failed.");return program; }
}
