package com.wisestay.scanner;
import org.junit.Test;
import static org.junit.Assert.*;
public class VoxelMapTest {
 @Test public void repeatedObservationsFuse() { VoxelMap map=new VoxelMap(.025f,100,100);assertEquals(0,map.point(0,0,0,1,0,0));assertEquals(0,map.point(.01f,0,0,1,0,0));assertEquals(1,map.vertexCount());assertEquals(.005f,map.snapshot().positions[0],.00001f); }
 @Test public void invalidDepthIsNotGeometry() { VoxelMap map=new VoxelMap(.025f,100,100);assertEquals(-1,map.point(Float.NaN,0,0,1,0,0));assertEquals(0,map.vertexCount()); }
 @Test public void vertexBudgetIsBounded() { VoxelMap map=new VoxelMap(.025f,1,10);map.point(0,0,0,1,0,0);assertEquals(-1,map.point(1,0,0,1,0,0));assertTrue(map.capacityReached);assertEquals(1,map.vertexCount()); }
 @Test public void trianglesAreDeduplicated() { VoxelMap m=new VoxelMap(.025f,10,10);int a=m.point(0,0,0,1,0,0),b=m.point(.1f,0,0,1,0,0),c=m.point(0,.1f,0,1,0,0);m.triangle(a,b,c);m.triangle(c,a,b);assertEquals(1,m.triangleCount()); }
 @Test public void largeDepthGapsAreNotBridged() { VoxelMap m=new VoxelMap(.025f,10,10);int a=m.point(0,0,0,1,0,0),b=m.point(.1f,0,0,1,0,0),c=m.point(0,.1f,5,1,0,0);m.triangle(a,b,c);assertEquals(0,m.triangleCount()); }
 @Test public void planarDepthAndCameraPoseAreApplied() {float[] pose={1,0,0,0,0,1,0,0,0,0,1,0,4,3,0,1};assertArrayEquals(new float[]{6,3,-2},VoxelMap.unproject(100,0,2,100,100,0,0,pose),.00001f);}
 @Test public void snapshotsAreIndependentCopies() {VoxelMap m=new VoxelMap(.025f,10,10);m.point(0,0,0,1,0,0);VoxelMap.Mesh first=m.snapshot();m.point(.01f,0,0,1,0,0);assertEquals(0,first.positions[0],.00001f);}
 @Test(expected=IllegalArgumentException.class) public void invalidBudgetRejected(){new VoxelMap(0,1,1);}
}
