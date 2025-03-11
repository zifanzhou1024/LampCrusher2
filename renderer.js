import { gl, g_CurrentPSO, GpuDevice, GpuMesh, GpuSkinnedMesh, GpuVertexShader, GpuFragmentShader, GpuGraphicsPSO } from "./gpu.js"
import { kShaders } from "./shaders.js"

import * as THREE from 'three';
import { Vector2, Vector3, Vector4, Matrix4, Euler, Quaternion, Box3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export const RenderBuffers = Object.freeze({
  kGBufferDiffuseMetallic: 0,
  kGBufferNormalRoughness: 1,
  kGBufferVelocity:        2,
  kGBufferDepth:           3,
  // kShadowMapLamp:          4,
  kShadowMapSun:           4,
  kPBRLighting:            5,
  kAccumulation:           6,
  kGBufferVelocityPrev:    7,
  kTAA:                    8,
  kPostProcessing:         9,
  kCount:                  10,
});

const kShadowMapSize = 4096;

const perspective_infinite_reverse_rh = (fov_y_rad, aspect_ratio, z_near) =>
{
  const sin_fov = Math.sin(0.5 * fov_y_rad);
  const cos_fov = Math.cos(0.5 * fov_y_rad);
  const h       = cos_fov / sin_fov;
  const w       = h / aspect_ratio;

  return new Matrix4().set(
    w,  0,  0,  0,
    0,  h,  0,  0,
    0,  0,  0,  z_near,
    0,  0, -1,  0,
  );
};

const perspective_matrix_rh = ( fov, aspect, near, far ) =>
{
  const f        = 1.0 / Math.tan( fov / 2 );

  return new Matrix4().set(
    f / aspect, 0, 0,                                   0,
    0,          f, 0,                                   0,
    0,          0, ( near + far ) / ( near - far ),    -1,
    0,          0, ( 2 * near * far ) / ( near - far ), 0
  );
}

export class Actor
{
  constructor( mesh, material, mass )
  {
    this.transform      = new Matrix4();
    this.prev_transform = null;
    this.velocity       = new Vector3( 0.0, 0.0, 0.0 );
    this.mesh           = mesh;
    this.material       = material;
    this.bounding_box   = null;
    this.force          = new Vector3( 0.0, 0.0, 0.0 );
    this.mass           = mass;
    this.aabb           = this.mesh.aabb;
  }

  set_position_euler_scale( position, euler, scale )
  {
    const rotation = new Quaternion();
    rotation.setFromEuler( euler );
    this.transform.compose( position, rotation, scale );
  }

  set_position( pos )
  {
    this.transform.setPosition( pos );
  }

  set_euler( euler )
  {
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale    = new Vector3();
    this.transform.decompose( position, rotation, scale );
    rotation.setFromEuler( euler );
    this.transform.compose( position, rotation, scale )
  }

  set_scale( scale )
  {
    const position = new Vector3();
    const rotation = new Quaternion();
    this.transform.decompose( position, rotation, new Vector3() );
    this.transform.compose( position, rotation, scale )
  }

  add_force( force )
  {
    this.force.add( force.clone().multiplyScalar( 1.0 / 0.08 ) );
  }

  get_force()
  {
    return this.force.clone();
  }

  get_velocity()
  {
    return this.velocity.clone();
  }

  get_position()
  {
    return ( new Vector3() ).setFromMatrixPosition( this.transform );
  }
  
  is_grounded()
  {
    return this.get_position().y < 0.01;
  }

  get_prev_position()
  {
    if ( !this.prev_transform )
    {
      return get_position();
    }

    return ( new Vector3() ).setFromMatrixPosition( this.prev_transform );
  }

  get_euler()
  {
    return ( new Euler() ).setFromRotationMatrix( this.transform, 'ZXY' );
  }

  get_quat()
  {
    return ( new Quaternion() ).setFromRotationMatrix( this.transform );
  }

  get_scale()
  {
    return ( new Vector3() ).setFromMatrixScale( this.transform );
  }

  update_anim( name, t )
  {
    this.mesh.update_anim( name, t, this.transform );
  }
}

export class AnimTrack
{
  constructor( name, times, values, type )
  {
    this.name   = name;
    this.times  = times;
    if ( type === 'vector' )
    {
      const array_to_vec3 = ( arr ) => Array.from(
        { length: arr.length / 3 },
        (_, i) => new Vector3(
          arr[ i * 3 + 0 ],
          arr[ i * 3 + 1 ],
          arr[ i * 3 + 2 ]
        )
      );

      this.values = array_to_vec3( values );
    }
    else if ( type === 'quaternion' )
    {
      const array_to_quat = ( arr ) => Array.from(
        { length: arr.length / 4 },
        (_, i) => new Quaternion(
          arr[ i * 4 + 0 ],
          arr[ i * 4 + 1 ],
          arr[ i * 4 + 2 ],
          arr[ i * 4 + 3 ]
        )
      );
      this.values = array_to_quat( values );
    }
  }
}

export class AnimClip
{
  constructor( name, position_tracks, rotation_tracks )
  {
    this.name      = name;
    this.positions = position_tracks;
    this.rotations = rotation_tracks;
  }

  get_bone_transform( bone_idx, t )
  {
    const track_get_a_v0_v1 = ( track ) =>
    {
      let i = 0;
      while ( i < track.times.length - 1 && track.times[ i + 1 ] <= t )
      {
        i++;
      }

      const t0 = track.times[ i + 0 ];
      const t1 = track.times[ i + 1 ] || t0;
      const a  = ( t1 - t0 ) > 0 ? ( t - t0 ) / ( t1 - t0 ) : 0.0;

      const v0 = track.values[ i + 0 ];
      const v1 = track.values[ i + 1 ] || v0;

      return [ a, v0, v1 ];
    }

    const transform = new Matrix4();

    {
      const [ a, q0, q1 ] = track_get_a_v0_v1( this.rotations[ bone_idx ] );
      const rotation      = new Quaternion().slerpQuaternions( q0, q1, a );
      transform.premultiply( new Matrix4().makeRotationFromQuaternion( rotation ) );
    }

    {
      const [ a, p0, p1 ] = track_get_a_v0_v1( this.positions[ bone_idx ] );
      const position      = p0.clone().lerp( p1, a );
      transform.setPosition( position );
    }

    return transform;
  }
}

export class Bone
{
  constructor( name, idx, transform, parent )
  {
    this.name              = name;

    this.transform         = transform.clone();
    this.prev_transform    = transform.clone();
    this.bind_pose         = transform.clone();
    this.inverse_bind_pose = transform.clone().invert();
    this.idx               = idx;

    this.children          = [];
    this.parent            = parent;

    if ( this.parent )
    {
      this.parent.children.push( this );
    }
  }
}

export class Skeleton
{
  constructor( root, transform )
  {
    this.root           = root;
    this.root_transform = transform.clone();

    const flatten_bones = ( bone, result = [] ) =>
    {
      result.push( bone );
      for ( let i = 0; i < bone.children.length; i++ )
      {
        flatten_bones( bone.children[ i ], result );
      }
      return result;
    }

    this.bones              = flatten_bones( root );
    this.bind_matrices      = new Array( this.bones.length );
    this.bone_matrices      = new Float32Array( this.bones.length * 4 * 4 );
    this.prev_bone_matrices = new Float32Array( this.bones.length * 4 * 4 );

    const fill_bind_matrices = ( bone, parent_transform = new Matrix4() ) =>
    {
      const world_transform = new Matrix4().multiplyMatrices( parent_transform, bone.bind_pose );

      for ( let i = 0; i < bone.children.length; i++ )
      {
        fill_bind_matrices( bone.children[ i ], world_transform.clone() );
      }

      // world_transform.toArray( this.bone_matrices, bone.idx * 16 );
      this.bind_matrices[ bone.idx ] = world_transform;
    }

    fill_bind_matrices( this.root );
    this.inverse_bind_matrices = this.bind_matrices.map( m => m.clone().invert() );
  }

  update_anim( anim_clip, t, transform )
  {
    for ( let i = 0; i < this.bones.length; i++ )
    {
      const bone          = this.bones[ i ];
      bone.prev_transform = bone.transform.clone();
      bone.transform      = anim_clip.get_bone_transform( i, t ); // bone.bind_pose.clone(); 
    }

    this.prev_bone_matrices = this.bone_matrices;
    this.bone_matrices      = new Float32Array( this.bones.length * 16 );
    const fill_bone_matrices = ( bone, parent_transform = new Matrix4() ) =>
    {
      const world_transform = new Matrix4().multiplyMatrices( parent_transform, bone.transform );

      for ( let i = 0; i < bone.children.length; i++ )
      {
        fill_bone_matrices( bone.children[ i ], world_transform.clone() );
      }

      const inverse_bind = this.inverse_bind_matrices[ bone.idx ];
      world_transform.multiply( inverse_bind ).toArray( this.bone_matrices, bone.idx * 16 );
    }

    fill_bone_matrices( this.root, new Matrix4().multiplyMatrices( transform, this.root_transform ) );
  }

  draw_debug( renderer, parent_transform = new Matrix4() )
  {
    for ( let i = 0; i < this.bones.length; i++ ) 
    {
      const bone_matrix =  new Matrix4().fromArray( this.bone_matrices, i * 16 );
      renderer.draw_debug_axes( bone_matrix.multiply( this.bind_matrices[ i ] ).multiply( new Matrix4().makeScale( 0.2, 0.2, 0.2 ) ) );
    }
  }
}

export class ModelSubset
{
  constructor( name, vertices, indices, transform )
  {
    this.name      = name;
    this.gpu_mesh  = new GpuMesh( vertices, indices );
    this.transform = transform
  }

  draw( model_uniform, parent_transform, prev_model_uniform, prev_parent_transform )
  {
    if ( model_uniform )
    {
      const model = new Matrix4().multiplyMatrices( parent_transform, this.transform );
      g_CurrentPSO.set_uniform( model_uniform, model.elements );
    }

    if ( prev_model_uniform )
    {
      const prev_model = new Matrix4().multiplyMatrices( parent_transform, this.transform );
      g_CurrentPSO.set_uniform( prev_model_uniform, prev_model.elements );
    }
    this.gpu_mesh.draw();
  }
}

export class SkinnedModelSubset
{
  constructor( name, vertices, indices, transform )
  {
    this.name      = name;
    this.gpu_mesh  = new GpuSkinnedMesh( vertices, indices );
    this.transform = transform;
  }

  draw( bone_matrices, prev_bone_matrices )
  {
    g_CurrentPSO.set_uniform( 'g_BoneMatrices',     bone_matrices           );
    g_CurrentPSO.set_uniform( 'g_PrevBoneMatrices', prev_bone_matrices      );
    g_CurrentPSO.set_uniform( 'g_Model',            this.transform.elements );
    this.gpu_mesh.draw();
  }
}

export class Model
{
  constructor( name, model_subsets, skeleton, animations )
  {
    this.name       = name;
    this.subsets    = model_subsets;

    let min = new Vector3(  Infinity,  Infinity,  Infinity );
    let max = new Vector3( -Infinity, -Infinity, -Infinity );
    for ( let isubset = 0; isubset < this.subsets.length; isubset++ )
    {
      const subset = this.subsets[ isubset ];
      for ( let ivertex = 0; ivertex < subset.gpu_mesh.vertices.length; ivertex += subset.gpu_mesh.stride )
      {
        const x = subset.gpu_mesh.vertices[ ivertex + 0 ];
        const y = subset.gpu_mesh.vertices[ ivertex + 1 ];
        const z = subset.gpu_mesh.vertices[ ivertex + 2 ];
        const pos = new Vector3( x, y, z ).applyMatrix4( subset.transform );
        
        min.x   = Math.min( min.x, pos.x );
        min.y   = Math.min( min.y, pos.y );
        min.z   = Math.min( min.z, pos.z );
        max.x   = Math.max( max.x, pos.x );
        max.y   = Math.max( max.y, pos.y );
        max.z   = Math.max( max.z, pos.z );
      }
    }

    this.aabb    = new Box3( min, max );
  }

  draw( model_uniform, model, prev_model_uniform, prev_model )
  {
    for ( let i = 0; i < this.subsets.length; i++ )
    {
      const subset = this.subsets[ i ];
      subset.draw( model_uniform, model, prev_model_uniform, prev_model );
    }
  }
}

export class SkinnedModel extends Model
{
  constructor( name, skinned_subsets, skeleton, animations )
  {
    super( name, skinned_subsets );
    this.skeleton   = skeleton
    this.animations = animations;

    let min = new Vector3(  Infinity,  Infinity,  Infinity );
    let max = new Vector3( -Infinity, -Infinity, -Infinity );
    for ( let isubset = 0; isubset < this.subsets.length; isubset++ )
    {
      const subset = this.subsets[ isubset ];
      for ( let ivertex = 0; ivertex < subset.gpu_mesh.vertices.length; ivertex += subset.gpu_mesh.stride )
      {
        const x = subset.gpu_mesh.vertices[ ivertex + 0 ];
        const y = subset.gpu_mesh.vertices[ ivertex + 1 ];
        const z = subset.gpu_mesh.vertices[ ivertex + 2 ];
        const pos = new Vector3( x, y, z ).applyMatrix4( this.skeleton.root_transform ).applyMatrix4( subset.transform );
        
        min.x   = Math.min( min.x, pos.x );
        min.y   = Math.min( min.y, pos.y );
        min.z   = Math.min( min.z, pos.z );
        max.x   = Math.max( max.x, pos.x );
        max.y   = Math.max( max.y, pos.y );
        max.z   = Math.max( max.z, pos.z );
      }
    }

    this.aabb    = new Box3( min, max );
  }

  update_anim( name, t, transform )
  {
    this.anim = name;
    this.t    = t;
  }

  draw( _, model )
  {
    const anim_clip = this.animations.get( this.anim );
    this.skeleton.update_anim( anim_clip, this.t, model );

    for ( let i = 0; i < this.subsets.length; i++ )
    {
      const subset = this.subsets[ i ];
      subset.draw( this.skeleton.bone_matrices, this.skeleton.prev_bone_matrices );
    }
  }
}

export class Camera
{
  constructor( fov_y_rad )
  {
    const aspect_ratio = gl.canvas.width / gl.canvas.height;

    this.transform     = new Matrix4();

    this.projection    = perspective_infinite_reverse_rh( fov_y_rad, aspect_ratio, 0.1 );
  }

  get_position()
  {
    return new Vector3().setFromMatrixPosition( this.transform );
  }

  look_at( target )
  {
    const position       = this.get_position();
    const kUp            = new Vector3( 0.0, 1.0, 0.0 );
    const look_at_matrix = new Matrix4().lookAt( position, target, kUp );

    const basis_x        = new Vector3();
    const basis_y        = new Vector3();
    const basis_z        = new Vector3();

    look_at_matrix.extractBasis( basis_x, basis_y, basis_z );

    this.transform.makeBasis( basis_x, basis_y, basis_z ).setPosition( position );
  }

  get_forward()
  {
    const forward = new Vector4( 0.0, 0.0, -1.0, 0.0 ).applyMatrix4( this.transform );
    return forward.normalize();
  }
}

export class Scene
{
  constructor()
  {
    this.actors            = new Map();
    this.camera            = null;
    this.directional_light = null;
    this.spot_light        = null;
    this.actor_id          = 0;
  }

  add( actor )
  {
    actor.id = ++this.actor_id;
    this.actors.set( actor.id, actor );
  }

  remove(actor) {
    // Remove actor from the internal map if it has an id.
    if (actor.id !== undefined) {
      this.actors.delete(actor.id);
    }
    // Only modify id if the actor is an instance of your custom Actor class.
    if (actor instanceof Actor) {
      actor.id = 0;
    }
  }
}

export class DirectionalLight
{
  constructor( direction, chromaticity, luminance )
  {
    this.direction    = direction;
    this.chromaticity = chromaticity;
    this.luminance    = luminance;
  }
}

export class SpotLight
{
  constructor( position, direction, chromaticity, luminance, inner_cutoff, outer_cutoff )
  {
    this.position     = position;
    this.direction    = direction;
    this.chromaticity = chromaticity;
    this.luminance    = luminance;
    this.inner_cutoff = inner_cutoff;
    this.outer_cutoff = outer_cutoff;
  }
}

export const kGroundMesh = new GpuMesh(
  [
    -100, 0, -100,     0, 1, 0,   0, 0,
     100, 0, -100,     0, 1, 0,   1, 0,
     100, 0,  100,     0, 1, 0,   1, 1,
    -100, 0,  100,     0, 1, 0,   0, 1,
  ],
  [0, 1, 2, 0, 2, 3]
);

export const kCubeMesh = new GpuMesh(
  [
    -1, -1, -1,        0, 0, -1,         0, 0, // Back face
     1, -1, -1,        0, 0, -1,         1, 0,
     1,  1, -1,        0, 0, -1,         1, 1,
    -1,  1, -1,        0, 0, -1,         0, 1,

    -1, -1,  1,        0, 0,  1,         0, 0, // Front face
     1, -1,  1,        0, 0,  1,         1, 0,
     1,  1,  1,        0, 0,  1,         1, 1,
    -1,  1,  1,        0, 0,  1,         0, 1,

    -1, -1, -1,       -1, 0, 0,         0, 0, // Left face
    -1, -1,  1,       -1, 0, 0,         1, 0,
    -1,  1,  1,       -1, 0, 0,         1, 1,
    -1,  1, -1,       -1, 0, 0,         0, 1,

     1, -1, -1,        1, 0, 0,         0, 0, // Right face
     1, -1,  1,        1, 0, 0,         1, 0,
     1,  1,  1,        1, 0, 0,         1, 1,
     1,  1, -1,        1, 0, 0,         0, 1,

    -1, -1, -1,        0, -1, 0,         0, 0, // Bottom face
     1, -1, -1,        0, -1, 0,         1, 0,
     1, -1,  1,        0, -1, 0,         1, 1,
    -1, -1,  1,        0, -1, 0,         0, 1,

    -1,  1, -1,        0, 1, 0,         0, 0, // Top face
     1,  1, -1,        0, 1, 0,         1, 0,
     1,  1,  1,        0, 1, 0,         1, 1,
    -1,  1,  1,        0, 1, 0,         0, 1,
  ],
  [
    // Indices for each face
    0, 1, 2, 0, 2, 3,  // Front
    4, 6, 5, 4, 7, 6,  // Back
    8, 9, 10, 8, 10, 11, // Left
    12, 14, 13, 12, 15, 14, // Right
    16, 17, 18, 16, 18, 19, // Bottom
    20, 22, 21, 20, 23, 22, // Top
  ]
);

export function load_gltf_model( asset, transform = new Matrix4() )
{
  const loader = new GLTFLoader();
  loader.setPath( '/assets/' );
  return new Promise( ( resolve, reject ) =>
  {
    loader.load( asset, ( gltf ) =>
    {
      const flatten_scene = ( node, result = [] ) =>
      {
        result.push( node );
        if ( node.children )
        {
          node.children.forEach( child => flatten_scene( child, result ) );
        }
        return result;
      };

      let bone_count = 0;

      const traverse_bones = ( node, parent = null ) =>
      {
        if ( !node.isBone && !parent )
        {
          if ( !node.children )
          {
            return null;
          }

          for ( let i = 0; i < node.children.length; i++ )
          {
            const root = traverse_bones( node.children[ i ] );
            if ( root )
            {
              return root;
            }
          }

          return null;
        }

        let bone = parent;
        if ( node.isBone )
        {
          // TODO(bshihabi): The way that we're doing bone indices is not really or robust...
          bone = new Bone( node.name, bone_count, node.matrix.clone(), parent );
          bone_count++;
        }

        if ( node.children )
        {
          node.children.forEach( child => traverse_bones( child, bone ) )
        }

        if ( !parent )
        {
          return new Skeleton( bone, transform );
        }
        else
        {
          return bone;
        }
      }

      const skeleton = traverse_bones( gltf.scene );

      const meshes  = flatten_scene( gltf.scene );
      const subsets = meshes.map( 
        ( obj ) =>
        {
          if ( !obj.isMesh )
          {
            return null;
          }

          const mesh     = obj;
          const geometry = mesh.geometry;

          if ( !geometry || !geometry.attributes || !geometry.index )
          {
            return null;
          }

          if ( !geometry.attributes.position || !geometry.attributes.normal )
          {
            return null;
          }


          const positions    = geometry.attributes.position.array;
          const normals      = geometry.attributes.normal.array;
          const uvs          = geometry.attributes.uv ? geometry.attributes.uv.array : new Float32Array( positions.length / 3 * 2 );
          const indices      = geometry.index.array;
          const bone_weights = geometry.attributes.skinWeight ? geometry.attributes.skinWeight.array : null;
          const bone_indices = geometry.attributes.skinIndex  ? geometry.attributes.skinIndex.array  : null;

          if ( !positions || !normals || !uvs || !indices )
          {
            return null;
          }

          const is_skinned    = bone_weights && bone_indices;

          const vertex_count  = positions.length / 3;
          const vertex_stride = is_skinned ? ( 3 + 3 + 2 + 2 + 2 ) : ( 3 + 3 + 2 );
          const vertices      = new Float32Array( vertex_count * vertex_stride );

          for ( let isrc = 0, idst = 0; isrc < vertex_count; isrc++ )
          {
              vertices[ idst++ ] = positions[ isrc * 3 + 0 ];
              vertices[ idst++ ] = positions[ isrc * 3 + 1 ];
              vertices[ idst++ ] = positions[ isrc * 3 + 2 ];

              vertices[ idst++ ] = normals[ isrc * 3 + 0 ];
              vertices[ idst++ ] = normals[ isrc * 3 + 1 ];
              vertices[ idst++ ] = normals[ isrc * 3 + 2 ];

              vertices[ idst++ ] = uvs[ isrc * 2 + 0 ];
              vertices[ idst++ ] = uvs[ isrc * 2 + 1 ];
              
              if ( is_skinned )
              {
                vertices[ idst++ ] = bone_weights[ isrc * 4 + 0 ];
                vertices[ idst++ ] = bone_weights[ isrc * 4 + 1 ];
                vertices[ idst++ ] = bone_indices[ isrc * 4 + 0 ];
                vertices[ idst++ ] = bone_indices[ isrc * 4 + 1 ];
              }
          }

          if ( is_skinned )
          {
            return new SkinnedModelSubset( mesh.name, vertices, indices, mesh.matrixWorld.clone() );
          }
          else
          {
            return new ModelSubset( mesh.name, vertices, indices, mesh.matrixWorld.clone().premultiply( transform ) );
          }
        }
      ).filter( subset => subset != null );

      if ( subsets.length === 0 )
      {
        reject( new Error( "No meshes found in scene!" ) );
        return null;
      }

      let animations = null;
      if ( skeleton )
      {
        const bones_name_to_idx = new Map( skeleton.bones.map( bone => [ bone.name, bone.idx ] ) );
        animations = new Map( 
          gltf.animations.map(
            clip =>
            {
              const track_bone_idx  = ( track ) => bones_name_to_idx.get( track.name.split( '.' )[ 0 ] );

              const tracks          = clip.tracks.map( track => new AnimTrack( track.name, track.times, track.values, track.ValueTypeName ) );
              const position_tracks = tracks.filter( track => track.name.split( '.' )[ 1 ] == 'position'   ).sort( ( a, b ) => track_bone_idx( a ) < track_bone_idx( b ) );
              const rotation_tracks = tracks.filter( track => track.name.split( '.' )[ 1 ] == 'quaternion' ).sort( ( a, b ) => track_bone_idx( a ) - track_bone_idx( b ) );
              return [ clip.name, new AnimClip( clip.name, position_tracks, rotation_tracks ) ];
            }
          )
        );

        const skinned_model = new SkinnedModel( `assets/${asset}`, subsets, skeleton, animations );
        resolve( skinned_model );
      }
      else
      {
        const model = new Model( `assets/${asset}`, subsets );
        resolve( model );
      }
    }, undefined, ( error ) =>
    {
      reject( new Error( "Error loading GLTF: " + error ) );
    });
  });
}

export class Material
{
  constructor( pixel_shader, uniforms )
  {
    this.pso = new GpuGraphicsPSO(
      new GpuVertexShader( kShaders.VS_ModelStdBasic ),
      new GpuFragmentShader( pixel_shader ),
      uniforms
    );
  }

  bind( uniforms )
  {
    this.pso.bind( uniforms );
  }
}

export class SkinnedMaterial
{
  constructor( pixel_shader, uniforms )
  {
    this.pso = new GpuGraphicsPSO(
      new GpuVertexShader( kShaders.VS_ModelSkinned ),
      new GpuFragmentShader( pixel_shader ),
      uniforms
    );
  }

  bind( uniforms )
  {
    this.pso.bind( uniforms );
  }
}

function orthographic_proj( left, right, bottom, top, near, far )
{
/*
  return (new Matrix4()).makeScale(1 / (right - left), 1 / (top - bottom), 1 / (far - near))
      .multiply((new Matrix4).makeTranslation(-left - right, -top - bottom, -near - far))
      .multiply((new Matrix4).makeScale(2, 2, -2));
      */
  return new Matrix4().makeOrthographic( left, right, top, bottom, near, far );
}

class DebugCubeDrawCmd
{
  constructor( transform, color )
  {
    this.transform = transform;
    this.color     = color;
  }
}

class DebugAxesDrawCmd
{
  constructor( transform )
  {
    this.transform = transform;
  }
}

class DebugCube
{
  constructor()
  {
    this.pso = new GpuGraphicsPSO(
      new GpuVertexShader(kShaders.VS_Debug),
      new GpuFragmentShader(kShaders.PS_Debug),
    );

    this.vertices = new Float32Array([
      -0.5, -0.5, -0.5,  0.5, -0.5, -0.5,  // Edge 1
       0.5, -0.5, -0.5,  0.5,  0.5, -0.5,  // Edge 2
       0.5,  0.5, -0.5, -0.5,  0.5, -0.5,  // Edge 3
      -0.5,  0.5, -0.5, -0.5, -0.5, -0.5,  // Edge 4
      
      -0.5, -0.5,  0.5,  0.5, -0.5,  0.5,  // Edge 5
       0.5, -0.5,  0.5,  0.5,  0.5,  0.5,  // Edge 6
       0.5,  0.5,  0.5, -0.5,  0.5,  0.5,  // Edge 7
      -0.5,  0.5,  0.5, -0.5, -0.5,  0.5,  // Edge 8

      -0.5, -0.5, -0.5, -0.5, -0.5,  0.5,  // Edge 9
       0.5, -0.5, -0.5,  0.5, -0.5,  0.5,  // Edge 10
       0.5,  0.5, -0.5,  0.5,  0.5,  0.5,  // Edge 11
      -0.5,  0.5, -0.5, -0.5,  0.5,  0.5   // Edge 12
    ]);

    this.vertex_buffer = gl.createBuffer();
    gl.bindBuffer( gl.ARRAY_BUFFER, this.vertex_buffer );
    gl.bufferData( gl.ARRAY_BUFFER, this.vertices, gl.STATIC_DRAW );
  }

  draw( cmd, view_proj )
  {
    this.pso.bind(
      {
        g_Model: cmd.transform.elements,
        g_ViewProj: view_proj.elements,
        g_Color: cmd.color.toArray()
      }
    );

    gl.bindBuffer( gl.ARRAY_BUFFER, this.vertex_buffer );
    gl.enableVertexAttribArray( 0 );
    gl.vertexAttribPointer( 0, 3, gl.FLOAT, false, 3 * Float32Array.BYTES_PER_ELEMENT, 0 );

    gl.drawArrays( gl.LINES, 0, this.vertices.length / 3 );
  }
}

class DebugAxes
{
  constructor()
  {
    this.pso = new GpuGraphicsPSO(
      new GpuVertexShader(kShaders.VS_DebugVertexColor),
      new GpuFragmentShader(kShaders.PS_DebugVertexColor),
    );

    this.vertices = new Float32Array([
      // Position     Color           Position       Color
      0.0, 0.0, 0.0,  1.0, 0.0, 0.0,  1.0, 0.0, 0.0,  1.0, 0.0, 0.0,   // X
      0.0, 0.0, 0.0,  0.0, 1.0, 0.0,  0.0, 1.0, 0.0,  0.0, 1.0, 0.0,   // Y
      0.0, 0.0, 0.0,  0.0, 0.0, 1.0,  0.0, 0.0, 1.0,  0.0, 0.0, 1.0,   // Z
    ]);

    this.vertex_buffer = gl.createBuffer();
    gl.bindBuffer( gl.ARRAY_BUFFER, this.vertex_buffer );
    gl.bufferData( gl.ARRAY_BUFFER, this.vertices, gl.STATIC_DRAW );
  }

  draw( cmd, view_proj )
  {
    this.pso.bind(
      {
        g_Model: cmd.transform.elements,
        g_ViewProj: view_proj.elements,
      }
    );

    gl.bindBuffer( gl.ARRAY_BUFFER, this.vertex_buffer );
    gl.enableVertexAttribArray( 0 );
    gl.vertexAttribPointer( 0, 3, gl.FLOAT, false, 6 * Float32Array.BYTES_PER_ELEMENT, 0 );

    gl.enableVertexAttribArray( 1 );
    gl.vertexAttribPointer( 1, 3, gl.FLOAT, false, 6 * Float32Array.BYTES_PER_ELEMENT, 3 * Float32Array.BYTES_PER_ELEMENT );

    gl.drawArrays( gl.LINES, 0, this.vertices.length / 3 );
  }
}

export class Renderer 
{
  constructor()
  {
    const draw_buffers_ext = gl.getExtension( "WEBGL_draw_buffers" );
    if ( !draw_buffers_ext )
    {
      alert( "Need WEBGL_draw_buffers extension!" );
    }

    const depth_texture_ext = gl.getExtension( "WEBGL_depth_texture" );
    if ( !depth_texture_ext )
    {
      alert( "Need WEBGL_depth_texture extension!" );
    }

    const float_texture_ext = gl.getExtension( "OES_texture_float" );
    if ( !float_texture_ext )
    {
      alert( "Need OES_texture_float extension!" );
    }

    const float_bilinear_ext = gl.getExtension( "OES_texture_float_linear" );
    if ( !float_bilinear_ext )
    {
      alert( "Need OES_texture_float_linear extension!" );
    }

    this.render_buffers = new Array( RenderBuffers.kCount );
    this.init_gbuffer( draw_buffers_ext );
    this.init_shadow_maps();
    this.init_pbr_buffer();
    this.init_taa_buffer();
    this.init_post_processing_buffer();

    this.quad = new GpuMesh(
      [
        -1.0, -1.0, 0.0,    0.0, 0.0, 1.0,      0.0, 0.0,
         1.0, -1.0, 0.0,    0.0, 0.0, 1.0,      1.0, 0.0,
         1.0,  1.0, 0.0,    0.0, 0.0, 1.0,      1.0, 1.0,
        -1.0,  1.0, 0.0,    0.0, 0.0, 1.0,      0.0, 1.0
      ],
      [0, 1, 2, 0, 2, 3]
    );

    this.standard_brdf   = new GpuGraphicsPSO(
      new GpuVertexShader(kShaders.VS_FullscreenQuad),
      new GpuFragmentShader(kShaders.PS_StandardBrdf),
      {
        g_DiffuseMetallic:      this.render_buffers[ RenderBuffers.kGBufferDiffuseMetallic ],
        g_NormalRoughness:      this.render_buffers[ RenderBuffers.kGBufferNormalRoughness ],
        g_Depth:                this.render_buffers[ RenderBuffers.kGBufferDepth           ],
        g_ShadowMapDirectional: this.render_buffers[ RenderBuffers.kShadowMapSun           ],
      }
    );
    this.taa             = new GpuGraphicsPSO(
      new GpuVertexShader(kShaders.VS_FullscreenQuad),
      new GpuFragmentShader(kShaders.PS_TAA),
      { 
        g_PBRBuffer:           this.render_buffers[ RenderBuffers.kPBRLighting         ],
        g_AccumulationBuffer:  this.render_buffers[ RenderBuffers.kAccumulation        ],
        g_GBufferVelocity:     this.render_buffers[ RenderBuffers.kGBufferVelocity     ],
        g_GBufferVelocityPrev: this.render_buffers[ RenderBuffers.kGBufferVelocityPrev ],
        g_GBufferDepth:        this.render_buffers[ RenderBuffers.kGBufferDepth        ],
        g_Dimensions:          [ gl.canvas.width, gl.canvas.height, 0.0 ],
      }
    );
    this.post_processing = new GpuGraphicsPSO(
      new GpuVertexShader(kShaders.VS_FullscreenQuad),
      new GpuFragmentShader(kShaders.PS_Tonemapping),
      { g_HDRBuffer: this.render_buffers[ RenderBuffers.kTAA ] }
    );

    // ***** ADD SMOKE SHADER  *****
    // this.smokeShader = new GpuGraphicsPSO(
    //     new GpuVertexShader(kShaders.VS_FullscreenQuad),
    //     new GpuFragmentShader(kShaders.PS_Smoke),
    //     {
    //       u_iResolution: [ gl.canvas.width, gl.canvas.height ],
    //       u_iTime: 0.0,
    //       u_iMouse: [ 0.0, 0.0 ],  // Update with actual mouse coordinates if available.
    //     }
    // );
    this.smokeShader = new GpuGraphicsPSO(
        new GpuVertexShader(kShaders.VS_Smoke),
        new GpuFragmentShader(kShaders.PS_Smoke),
        {
          u_iResolution: [ gl.canvas.width, gl.canvas.height ],
          u_iTime: 0.0,
          // u_iMouse: [ 0.0, 0.0 ],
        }
    );


    this.blit            = new GpuGraphicsPSO(
      new GpuVertexShader(kShaders.VS_FullscreenQuad),
      new GpuFragmentShader(kShaders.PS_Blit),
    );
    this.blit_buffer     = RenderBuffers.kPostProcessing;
    this.frame_id        = 0;
    this.enable_taa      = true;
    this.enable_pcf      = true;

    // ***** ADD SMOKE TRIGGER PROPERTY *****
    this.triggerSmoke = false;

    this.debug_cube           = new DebugCube();
    this.debug_axes           = new DebugAxes();
    this.debug_cube_draw_list = [];
    this.debug_axes_draw_list = [];
  }

  get_taa_jitter()
  {
    const kHaltonSequence =
    [
      new Vector2( 0.500000, 0.333333 ),
      new Vector2( 0.250000, 0.666667 ),
      new Vector2( 0.750000, 0.111111 ),
      new Vector2( 0.125000, 0.444444 ),
      new Vector2( 0.625000, 0.777778 ),
      new Vector2( 0.375000, 0.222222 ),
      new Vector2( 0.875000, 0.555556 ),
      new Vector2( 0.062500, 0.888889 ),
      new Vector2( 0.562500, 0.037037 ),
      new Vector2( 0.312500, 0.370370 ),
      new Vector2( 0.812500, 0.703704 ),
      new Vector2( 0.187500, 0.148148 ),
      new Vector2( 0.687500, 0.481481 ),
      new Vector2( 0.437500, 0.814815 ),
      new Vector2( 0.937500, 0.259259 ),
      new Vector2( 0.031250, 0.592593 ),
    ];

    const idx = this.frame_id % kHaltonSequence.length;
    let   ret = kHaltonSequence[ idx ].sub( new Vector2( 0.5, 0.5 ) ).multiply( new Vector2( 2.0 / gl.canvas.width, 2.0 / gl.canvas.height) );
    return new Vector3(ret.x, ret.y);
  }

  cycle_blit_buffer()
  {
    this.blit_buffer = ( this.blit_buffer + 1 ) % RenderBuffers.kCount;
    console.log( this.blit_buffer );
  }

  init_gbuffer( draw_buffers_ext )
  {
    this.gbuffer = gl.createFramebuffer();
    
    this.render_buffers[ RenderBuffers.kGBufferDiffuseMetallic ] = gl.createTexture();
    this.render_buffers[ RenderBuffers.kGBufferNormalRoughness ] = gl.createTexture();
    this.render_buffers[ RenderBuffers.kGBufferVelocity        ] = gl.createTexture();
    this.render_buffers[ RenderBuffers.kGBufferDepth           ] = gl.createTexture();

    gl.bindTexture( gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kGBufferDiffuseMetallic ] );
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, gl.canvas.width, gl.canvas.height, 0, gl.RGBA, gl.FLOAT, null );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE );

    gl.bindTexture( gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kGBufferNormalRoughness ] );
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, gl.canvas.width, gl.canvas.height, 0, gl.RGBA, gl.FLOAT, null );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE );

    gl.bindTexture( gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kGBufferVelocity ] );
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA,  gl.canvas.width, gl.canvas.height, 0, gl.RGBA, gl.FLOAT, null );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE );

    gl.bindTexture( gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kGBufferDepth ] );
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, gl.canvas.width, gl.canvas.height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE );

    gl.bindFramebuffer( gl.FRAMEBUFFER, this.gbuffer );
    gl.framebufferTexture2D( gl.FRAMEBUFFER, draw_buffers_ext.COLOR_ATTACHMENT0_WEBGL, gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kGBufferDiffuseMetallic ], 0 );
    gl.framebufferTexture2D( gl.FRAMEBUFFER, draw_buffers_ext.COLOR_ATTACHMENT1_WEBGL, gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kGBufferNormalRoughness ], 0 );
    gl.framebufferTexture2D( gl.FRAMEBUFFER, draw_buffers_ext.COLOR_ATTACHMENT2_WEBGL, gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kGBufferVelocity        ], 0 );
    gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,                      gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kGBufferDepth           ], 0 );

    let framebuffer_status = gl.checkFramebufferStatus( gl.FRAMEBUFFER );
    if ( framebuffer_status !== gl.FRAMEBUFFER_COMPLETE )
    {
      console.log( framebuffer_status == gl.FRAMEBUFFER_UNSUPPORTED );
      alert( "Failed to create GBuffer!" );
    }

    draw_buffers_ext.drawBuffersWEBGL( [
      draw_buffers_ext.COLOR_ATTACHMENT0_WEBGL,
      draw_buffers_ext.COLOR_ATTACHMENT1_WEBGL,
      draw_buffers_ext.COLOR_ATTACHMENT2_WEBGL,
      draw_buffers_ext.COLOR_ATTACHMENT3_WEBGL,
    ] );

    this.velocity_prev = gl.createFramebuffer();
    this.render_buffers[ RenderBuffers.kGBufferVelocityPrev ] = gl.createTexture();

    gl.bindTexture( gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kGBufferVelocityPrev ] );
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA,  gl.canvas.width, gl.canvas.height, 0, gl.RGBA, gl.FLOAT, null );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE );

    gl.bindFramebuffer( gl.FRAMEBUFFER, this.velocity_prev );
    gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kGBufferVelocityPrev ], 0 );

    framebuffer_status = gl.checkFramebufferStatus( gl.FRAMEBUFFER );
    if ( framebuffer_status !== gl.FRAMEBUFFER_COMPLETE )
    {
      alert( "Failed to create Velocity Prev!" );
    }

    gl.bindTexture( gl.TEXTURE_2D, null );
    gl.bindFramebuffer( gl.FRAMEBUFFER, null );
  }

  init_pbr_buffer()
  {
    this.pbr_buffer = gl.createFramebuffer();
    
    this.render_buffers[ RenderBuffers.kPBRLighting  ] = gl.createTexture();

    gl.bindTexture( gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kPBRLighting ] );
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, gl.canvas.width, gl.canvas.height, 0, gl.RGBA, gl.FLOAT, null );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE );

    gl.bindFramebuffer( gl.FRAMEBUFFER, this.pbr_buffer );
    gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kPBRLighting  ], 0 );

    let framebuffer_status = gl.checkFramebufferStatus( gl.FRAMEBUFFER );
    if ( framebuffer_status !== gl.FRAMEBUFFER_COMPLETE )
    {
      alert( "Failed to create PBR Buffer!" );
    }

    gl.bindTexture( gl.TEXTURE_2D, null );
    gl.bindFramebuffer( gl.FRAMEBUFFER, null );
  }

  init_taa_buffer()
  {
    this.taa_buffer = gl.createFramebuffer();
    
    this.render_buffers[ RenderBuffers.kTAA ] = gl.createTexture();

    gl.bindTexture( gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kTAA ] );
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, gl.canvas.width, gl.canvas.height, 0, gl.RGBA, gl.FLOAT, null );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE );

    gl.bindFramebuffer( gl.FRAMEBUFFER, this.taa_buffer );
    gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kTAA  ], 0 );

    let framebuffer_status = gl.checkFramebufferStatus( gl.FRAMEBUFFER );
    if ( framebuffer_status !== gl.FRAMEBUFFER_COMPLETE )
    {
      alert( "Failed to create TAA Buffer!" );
    }

    this.accumulation_buffer = gl.createFramebuffer();

    this.render_buffers[ RenderBuffers.kAccumulation ] = gl.createTexture();

    gl.bindTexture( gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kAccumulation ] );
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, gl.canvas.width, gl.canvas.height, 0, gl.RGBA, gl.FLOAT, null );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE );

    gl.bindFramebuffer( gl.FRAMEBUFFER, this.accumulation_buffer );
    gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kAccumulation ], 0 );

    framebuffer_status = gl.checkFramebufferStatus( gl.FRAMEBUFFER );
    if ( framebuffer_status !== gl.FRAMEBUFFER_COMPLETE )
    {
      alert( "Failed to create accumulation buffer!" );
    }
  }

  init_post_processing_buffer()
  {
    this.post_processing_buffer = gl.createFramebuffer();
    
    this.render_buffers[ RenderBuffers.kPostProcessing ] = gl.createTexture(); 

    gl.bindTexture( gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kPostProcessing ] );
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGBA, gl.canvas.width, gl.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     gl.CLAMP_TO_EDGE );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     gl.CLAMP_TO_EDGE );

    gl.bindFramebuffer( gl.FRAMEBUFFER, this.post_processing_buffer );
    gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kPostProcessing ], 0 );

    const framebuffer_status = gl.checkFramebufferStatus( gl.FRAMEBUFFER );
    if ( framebuffer_status !== gl.FRAMEBUFFER_COMPLETE )
    {
      alert( "Failed to create PostProcessing Buffer!" );
    }

    gl.bindTexture( gl.TEXTURE_2D, null );
    gl.bindFramebuffer( gl.FRAMEBUFFER, null );
  }

  init_shadow_maps()
  {
    this.directional_shadow_map = gl.createFramebuffer();

    this.render_buffers[ RenderBuffers.kShadowMapSun ] = gl.createTexture();

    gl.bindTexture( gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kShadowMapSun ] );
    gl.texImage2D( gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, kShadowMapSize, kShadowMapSize, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER,   gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,   gl.LINEAR );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,       gl.CLAMP_TO_EDGE );
    gl.texParameteri( gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,       gl.CLAMP_TO_EDGE );


    gl.bindFramebuffer( gl.FRAMEBUFFER, this.directional_shadow_map );
    gl.framebufferTexture2D( gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,  gl.TEXTURE_2D, this.render_buffers[ RenderBuffers.kShadowMapSun ], 0 );

    let framebuffer_status = gl.checkFramebufferStatus( gl.FRAMEBUFFER );
    if ( framebuffer_status !== gl.FRAMEBUFFER_COMPLETE )
    {
      console.log( framebuffer_status == gl.FRAMEBUFFER_UNSUPPORTED ); 
      alert( "Failed to create ShadowMapSun Buffer!" );
    }

    gl.bindTexture( gl.TEXTURE_2D, null );
    gl.bindFramebuffer( gl.FRAMEBUFFER, null );
  }

  render_handler_gbuffer( scene )
  {
    gl.bindFramebuffer( gl.FRAMEBUFFER, this.gbuffer );
    gl.viewport( 0, 0, gl.canvas.width, gl.canvas.height );
    gl.clearColor( 0.0, 0.0, 0.0, 0.0 );
    gl.clearDepth( 0.0 );
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
    gl.depthFunc( gl.GREATER );
    gl.depthMask( true );
    gl.disable( gl.BLEND );
    gl.enable( gl.DEPTH_TEST );

    scene.actors.forEach( 
      ( actor ) =>
      {
        if ( !actor.mesh || !actor.material )
        {
          return;
        }
      
        actor.material.bind(
          {
            g_ViewProj:     this.view_proj.elements,
            g_PrevViewProj: this.prev_view_proj.elements,
            g_TAAJitter:    this.taa_jitter.toArray(),
          }
        );

        actor.mesh.draw( 'g_Model', actor.transform, 'g_PrevModel', actor.prev_transform );

        const error = gl.getError();
        if ( error !== gl.NO_ERROR )
        {
          console.error( "WebGL error: " + error );
        }
      }
    );
  }


  render_handler_directional_shadow( scene )
  {
    gl.bindFramebuffer( gl.FRAMEBUFFER, this.directional_shadow_map );
    gl.viewport( 0, 0, kShadowMapSize, kShadowMapSize );
    gl.clearDepth( 1.0 );
    gl.clear( gl.DEPTH_BUFFER_BIT );
    gl.depthFunc( gl.LESS );

    if ( !scene.directional_light )
      return;


    const target = new Vector3( 0.0, 0.0, 0.0 );
    const camera = target.clone().sub( scene.directional_light.direction.clone().normalize().multiplyScalar( 10.0 ) );

    this.directional_light_proj      = orthographic_proj( -25, 25, -25, 25, 0.1, 30 );
    this.directional_light_view      = (new Matrix4()).lookAt( camera, target, new Vector3( 0, 0, 1 ) ).setPosition( camera ).invert();
    this.directional_light_view_proj = (new Matrix4()).multiplyMatrices( this.directional_light_proj, this.directional_light_view );

    scene.actors.forEach(
      ( actor ) =>
      {
        if ( !actor.mesh || !actor.material )
        {
          return;
        }

        actor.material.bind(
          {
            g_Model:        actor.transform.elements,
            g_ViewProj:     this.directional_light_view_proj.elements,
            g_PrevViewProj: this.directional_light_view_proj.elements,
            g_TAAJitter:    [0, 0, 0],
          }
        )
        actor.mesh.draw( 'g_Model', actor.transform, 'g_PrevModel', actor.prev_transform );
      }
    );
  }

/*
  render_handler_spot_shadow()
  {
    gl.bindFramebuffer( gl.FRAMEBUFFER, this.directional_shadow_map );
    gl.viewport( 0, 0, kShadowMapSize, kShadowMapSize );
    gl.clear( gl.DEPTH_BUFFER_BIT );
    gl.depthFunc( gl.LESS );

    if ( !program_state.directional_light )
      return;


    program_state.spot_light_view = Mat4.look_at(
      program_state.spot_light.position,
      program_state.spot_light.position.plus( program_state.spot_light.direction ),
      vec3( 0, 1, 0 )
    );
    program_state.spot_light_proj = Mat4.perspective( program_state.spot_light.outer_cutoff, 1, 0.01, 1000.0 );

    const orig_view = Mat4.identity().times(program_state.camera_inverse);
    const orig_proj = Mat4.identity().times(program_state.projection_transform);

    program_state.set_camera( program_state.directional_light_view );
    program_state.projection_transform = program_state.directional_light_proj;

    scene.actors.forEach(
      ( actor ) =>
      {
        const actor = actors[ iactor ];
        if ( !actor.mesh || !actor.material )
        {
          return;
        }
        actor.mesh.draw( context, program_state, actor, actor.material );
      }
    );

    program_state.set_camera( orig_view );
    program_state.projection_transform = orig_proj;
  }
*/


  render_handler_lighting( scene )
  {
    gl.bindFramebuffer( gl.FRAMEBUFFER, this.pbr_buffer );
    gl.viewport( 0, 0, gl.canvas.width, gl.canvas.height );
    gl.clearColor( 0.7578125, 0.81640625, 0.953125, 1.0 );
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
    gl.depthFunc( gl.ALWAYS );

    const camera_center = (new Vector4( 0, 0, 0, 1 )).applyMatrix4(scene.camera.transform);
    if ( !scene.spot_light )
    {
      return;
    }

    this.standard_brdf.bind( 
      {
        g_InverseViewProj:              this.inverse_view_proj.elements,
        g_DirectionalLightDirection:    scene.directional_light.direction.toArray(),
        g_DirectionalLightChromaticity: scene.directional_light.chromaticity.toArray(),
        g_DirectionalLightLuminance:    scene.directional_light.luminance,
        g_SpotLightDirection:           scene.spot_light.direction.toArray(),
        g_SpotLightPosition:            scene.spot_light.position.toArray(),
        g_SpotLightChromaticity:        scene.spot_light.chromaticity.toArray(),
        g_SpotLightLuminance:           scene.spot_light.luminance,
        g_SpotLightInnerCutoff:         Math.cos( scene.spot_light.inner_cutoff ),
        g_SpotLightOuterCutoff:         Math.cos( scene.spot_light.outer_cutoff ),

        g_DirectionalLightViewProj:     this.directional_light_view_proj.elements,
        g_WSCameraPosition:             [ camera_center.x, camera_center.y, camera_center.z ],
        g_SkyColor:                     [ 0.403, 0.538, 1.768 ],
        g_EnablePCF:                    1,
      }
    );
    this.quad.draw();
  }

  render_handler_taa()
  {
    gl.bindFramebuffer( gl.FRAMEBUFFER, this.taa_buffer );
    gl.viewport( 0, 0, gl.canvas.width, gl.canvas.height );
    gl.clearColor( 0.7578125, 0.81640625, 0.953125, 1.0 );
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );

    gl.depthFunc( gl.ALWAYS );
    if ( this.enable_taa )
    {
      this.taa.bind({});
      this.quad.draw();
    }
    else
    {
      this.blit.bind( { g_Sampler: this.render_buffers[ RenderBuffers.kPBRLighting ] } );
      this.quad.draw();
    }
  }

  render_handler_post_processing()
  {
    gl.bindFramebuffer( gl.FRAMEBUFFER, this.post_processing_buffer );
    gl.viewport( 0, 0, gl.canvas.width, gl.canvas.height );
    gl.clearColor( 0.0, 0.0, 0.0, 0.0 );
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
    gl.depthFunc( gl.ALWAYS );

    this.post_processing.bind({});
    this.quad.draw();
  }

  // ***** ADD SMOKE RENDER HANDLER *****
  render_handler_smoke()
  {
    // Bind to the default framebuffer (or to a dedicated buffer if desired)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Enable blending for a natural, smoke‐like fade.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Update uniforms for the smoke shader.
    this.smokeShader.bind({
      u_iResolution: [ gl.canvas.width, gl.canvas.height ],
      u_iTime: performance.now() / 1000.0,
      // u_iMouse: [ 0.0, 0.0 ]  // Replace with your actual mouse coordinates if available.
    });

    // Render the fullscreen quad with the smoke effect.
    this.quad.draw();

    gl.disable(gl.BLEND);
  }

// // Render smoke at a specific transform (position, rotation, scale)
//   render_handler_smoke_at(transform) {
//     // Compute the inverse of the model transform.
//     let invTransform = transform.clone().invert();
//
//     // Bind to the default framebuffer and set the viewport.
//     gl.bindFramebuffer(gl.FRAMEBUFFER, null);
//     gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
//
//     // Enable alpha blending for a natural, smoke‐like fade.
//     gl.enable(gl.BLEND);
//     gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
//
//     // Bind the smoke shader and pass the required uniforms.
//     this.smokeShader.bind({
//       u_iResolution: [ gl.canvas.width, gl.canvas.height ],
//       u_iTime: performance.now() / 1000.0,
//       u_iMouse: [ 0.0, 0.0 ],
//       g_Model: transform.elements,
//       g_ModelInv: invTransform.elements
//     });
//
//     // Draw the fullscreen quad (the shader uses the model transforms to localize the effect).
//     this.quad.draw();
//
//     // Disable blending.
//     gl.disable(gl.BLEND);
//   }
  // Render smoke at a specific transform (position, rotation, scale)
  render_handler_smoke_at(transform) {
    let invTransform = transform.clone().invert();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Build the uniforms object.
    const uniforms = {
      u_iResolution: [gl.canvas.width, gl.canvas.height],
      u_iTime: performance.now() / 1000.0,
      u_CamPos: this.cameraPosition.toArray(), // stored during submit()
      u_InverseViewProj: this.inverse_view_proj.elements,
      g_Model: transform.elements,
      g_ModelInv: invTransform.elements,
      u_ViewProj: this.view_proj.elements
    };

    // Bind the shader without trying to set u_iMouse.
    this.smokeShader.bind(uniforms);
    this.quad.draw();

    gl.disable(gl.BLEND);
  }








  render_handler_copy_temporal()
  {
    gl.bindFramebuffer( gl.FRAMEBUFFER, this.accumulation_buffer );
    gl.viewport( 0, 0, gl.canvas.width, gl.canvas.height );
    gl.clearColor( 0.0, 0.0, 0.0, 0.0 );
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
    gl.depthFunc( gl.ALWAYS );

    this.blit.bind( { g_Sampler: this.render_buffers[ RenderBuffers.kTAA ] } );
    this.quad.draw();

    gl.bindFramebuffer( gl.FRAMEBUFFER, this.velocity_prev );
    gl.viewport( 0, 0, gl.canvas.width, gl.canvas.height );
    gl.clearColor( 0.0, 0.0, 0.0, 0.0 );
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
    gl.depthFunc( gl.ALWAYS );

    this.blit.bind( { g_Sampler: this.render_buffers[ RenderBuffers.kGBufferVelocity ] } );
    this.quad.draw();
  }

  render_handler_blit()
  {
    gl.bindFramebuffer( gl.FRAMEBUFFER, null );
    gl.viewport( 0, 0, gl.canvas.width, gl.canvas.height );
    gl.clearColor( 0.0, 0.0, 0.0, 0.0 );
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
    gl.depthFunc( gl.ALWAYS );

    this.blit.bind( { g_Sampler: this.render_buffers[ this.blit_buffer ] } );
    this.quad.draw();
  }

  render_handler_debug()
  {
    gl.bindFramebuffer( gl.FRAMEBUFFER, null );
    gl.viewport( 0, 0, gl.canvas.width, gl.canvas.height );
    gl.depthFunc( gl.ALWAYS );

    for ( let i = 0; i < this.debug_cube_draw_list.length; i++ )
    {
      this.debug_cube.draw( this.debug_cube_draw_list[ i ], this.view_proj );
    }

    for ( let i = 0; i < this.debug_axes_draw_list.length; i++ )
    {
      this.debug_axes.draw( this.debug_axes_draw_list[ i ], this.view_proj );
    }

    this.debug_cube_draw_list = [];
    this.debug_axes_draw_list = [];
  }

  draw_debug_cube( transform, color )
  {
    this.debug_cube_draw_list.push( new DebugCubeDrawCmd( transform, color ) );
  }

  draw_debug_axes( transform )
  {
    this.debug_axes_draw_list.push( new DebugAxesDrawCmd( transform ) );
  }

  draw_obb( transform, aabb, color )
  {
    const size   = aabb.max.clone().sub( aabb.min );
    const center = aabb.max.clone().add( aabb.min ).multiplyScalar( 0.5 );

    const translation_matrix = new Matrix4().setPosition( center.x, center.y, center.z );
    const scale_matrix       = new Matrix4().makeScale( size.x, size.y, size.z );
    
    const cube_transform = new Matrix4().multiply( transform ).multiply( translation_matrix ).multiply( scale_matrix );
    this.draw_debug_cube( cube_transform, color );
  }

  submit( scene )
  {
    scene.actors.forEach( 
      ( actor ) =>
      {
        if ( !actor.prev_transform )
        {
          actor.prev_transform = actor.transform.clone();
        }
      }
    );

    if ( this.enable_taa )
    {
      this.taa_jitter = this.get_taa_jitter();
    }
    else
    {
      this.taa_jitter = new Vector3( 0, 0, 0 );
    }

    this.view = scene.camera.transform.clone().invert();
    this.view_proj = new Matrix4().multiplyMatrices(scene.camera.projection, this.view);
    this.inverse_view_proj = this.view_proj.clone().invert();

    // Save camera position for later use by the smoke shader
    this.cameraPosition = scene.camera.get_position();

    if ( !this.prev_view_proj )
    {
      this.prev_view      = this.view.clone();
      this.prev_view_proj = this.view_proj.clone();
    }

    this.render_handler_gbuffer( scene );

      
    this.render_handler_directional_shadow( scene );
    this.enable_pcf = this.enable_pcf;

    this.render_handler_lighting( scene );
    this.render_handler_taa();
    this.render_handler_copy_temporal();
    this.render_handler_post_processing();
    // ***** CONDICIONAL SMOKE EFFECT RENDERING *****
    // if (this.triggerSmoke) {
    //   this.render_handler_smoke();
    //   this.triggerSmoke = false;
    // }
    // Render smoke effect now if flagged:
    //this.render_handler_smoke();

    this.render_handler_blit();
    if (this.triggerSmoke && this.smokeTransform) {
      this.render_handler_smoke_at(this.smokeTransform);
      this.triggerSmoke = false;
    }
    this.render_handler_debug();

    this.prev_view      = this.view.clone();
    // Save camera position for later use by the smoke shader
    this.cameraPosition = scene.camera.get_position();
    this.prev_view_proj = this.view_proj.clone();

    scene.actors.forEach( 
      ( actor ) =>
      {
        actor.prev_transform = actor.transform.clone();
      }
    );

    this.frame_id++;
  }
};
