import { gl, GpuDevice, GpuMesh, GpuVertexShader, GpuFragmentShader, GpuGraphicsPSO } from "./gpu.js"
import { kShaders } from "./shaders.js"

import * as THREE from 'three';
import { Vector2, Vector3, Vector4, Matrix4 } from 'three';

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

export class Camera
{
  constructor()
  {
    this.transform = Matrix4.identity();
  }
}

export class Scene
{
  constructor()
  {
    this.actors            = [];
    this.camera            = null;
    this.directional_light = null;
    this.spot_light        = null;
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

export class Ground
{
  constructor()
  {
    this.mesh = new GpuMesh(
      [
        -100, 0, -100,    0, 1, 0,   0, 0,
         100, 0, -100,    0, 1, 0,   1, 0,
        -100, 0,  100,    0, 1, 0,   0, 1,
         100, 0,  100,    0, 1, 0,   1, 1,
      ],
      [0, 1, 2, 1, 3, 2]
    );
  }

  draw()
  {
    this.mesh.draw();
  }
}

export class Material
{
  constructor(pixel_shader, uniforms)
  {
    this.pso = new GpuGraphicsPSO(
      new GpuVertexShader(kShaders.VS_ModelStdBasic),
      new GpuFragmentShader(pixel_shader),
      uniforms
    );
  }

  bind(uniforms)
  {
    this.pso.bind(uniforms);
  }
}
export class Mesh
{
  constructor(path)
  {
    this.gpu_mesh = new GpuMesh();
  }
}

function orthographic_proj( left, right, bottom, top, near, far )
{
  return Matrix4.makeScale(1 / (right - left), 1 / (top - bottom), 1 / (far - near))
      .multiply(Matrix4.makeTranslation(-left - right, -top - bottom, -near - far))
      .multiply(Matrix4.makeScale(2, 2, -2));
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
      }
    );
    this.post_processing = new GpuGraphicsPSO(
      new GpuVertexShader(kShaders.VS_FullscreenQuad),
      new GpuFragmentShader(kShaders.PS_Tonemapping),
      { g_HDRBuffer: this.render_buffers[ RenderBuffers.kTAA ] }
    );
    this.blit            = new GpuGraphicsPSO(
      new GpuVertexShader(kShaders.VS_FullscreenQuad),
      new GpuFragmentShader(kShaders.PS_Blit),
    );
    this.blit_buffer     = RenderBuffers.kGBufferDiffuseMetallic; // RenderBuffers.kPostProcessing;
    this.frame_id        = 0;
    this.enable_taa      = true;
    this.enable_pcf      = true;
  }

  get_taa_jitter()
  {
    const kHaltonSequence =
    [
      Vector2( 0.500000, 0.333333 ),
      Vector2( 0.250000, 0.666667 ),
      Vector2( 0.750000, 0.111111 ),
      Vector2( 0.125000, 0.444444 ),
      Vector2( 0.625000, 0.777778 ),
      Vector2( 0.375000, 0.222222 ),
      Vector2( 0.875000, 0.555556 ),
      Vector2( 0.062500, 0.888889 ),
      Vector2( 0.562500, 0.037037 ),
      Vector2( 0.312500, 0.370370 ),
      Vector2( 0.812500, 0.703704 ),
      Vector2( 0.187500, 0.148148 ),
      Vector2( 0.687500, 0.481481 ),
      Vector2( 0.437500, 0.814815 ),
      Vector2( 0.937500, 0.259259 ),
      Vector2( 0.031250, 0.592593 ),
    ];

    const idx = this.frame_id % kHaltonSequence.length;
    let   ret = kHaltonSequence[ idx ].minus( vec( 0.5, 0.5 ) ).times_pairwise( vec( 2.0 / gl.canvas.width, 2.0 / gl.canvas.height) );
    return ret.to3();
  }

  cycle_blit_buffer()
  {
    this.blit_buffer = ( this.blit_buffer + 1 ) % RenderBuffers.kCount;
    // this.blit        = new Material( new FullscreenShader(), { texture: this.render_buffers[ this.blit_buffer ] } );
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

  render_handler_gbuffer()
  {
    gl.bindFramebuffer( gl.FRAMEBUFFER, this.gbuffer );
    gl.viewport( 0, 0, gl.canvas.width, gl.canvas.height );
    gl.clearColor( 0.0, 0.0, 0.0, 0.0 );
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
    gl.depthFunc( gl.LESS );
    gl.disable( gl.BLEND );

    for ( let iactor = 0; iactor < actors.length; iactor++ )
    {
      const actor = actors[ iactor ];
      if ( !actor.mesh || !actor.material )
        continue;
      if ( !actor.prev_transform )
      {
        actor.prev_transform = actor.transform;
      }
      actor.material.bind(
        {
          g_Model:    actor.transform.elements,
        }
      );
      actor.mesh.draw( context, program_state, actor, actor.material );
      actor.prev_transform = actor.transform;
    }
  }


  render_handler_directional_shadow()
  {
    gl.bindFramebuffer( gl.FRAMEBUFFER, this.directional_shadow_map );
    gl.viewport( 0, 0, kShadowMapSize, kShadowMapSize );
    gl.clear( gl.DEPTH_BUFFER_BIT );
    gl.depthFunc( gl.LESS );

    if ( !program_state.directional_light )
      return;


    const camera_center = program_state.camera_transform.times( vec4( 0, 0, -40, 1 ) ).to3();
    program_state.directional_light_view = Mat4.look_at(
      camera_center.plus( program_state.directional_light.direction.normalized().times( -40 ) ),
      camera_center,
      vec3( 0, 1, 0 )
    );
    program_state.directional_light_proj = orthographic_proj( -35, 35, -35, 35, 0.1, 75 );

    const orig_view = Mat4.identity().times(program_state.camera_inverse);
    const orig_proj = Mat4.identity().times(program_state.projection_transform);

    program_state.set_camera( program_state.directional_light_view );
    program_state.projection_transform = program_state.directional_light_proj;

    for ( let iactor = 0; iactor < actors.length; iactor++ )
    {
      const actor = actors[ iactor ];
      if ( !actor.mesh || !actor.material )
        continue;
      actor.mesh.draw( context, program_state, actor, actor.material );
    }

    program_state.set_camera( orig_view );
    program_state.projection_transform = orig_proj;
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

    for ( let iactor = 0; iactor < actors.length; iactor++ )
    {
      const actor = actors[ iactor ];
      if ( !actor.mesh || !actor.material )
        continue;
      actor.mesh.draw( context, program_state, actor, actor.material );
    }

    program_state.set_camera( orig_view );
    program_state.projection_transform = orig_proj;
  }
*/


  render_handler_lighting()
  {
    gl.bindFramebuffer( gl.FRAMEBUFFER, this.pbr_buffer );
    gl.viewport( 0, 0, gl.canvas.width, gl.canvas.height );
    gl.clearColor( 0.7578125, 0.81640625, 0.953125, 1.0 );
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );

    gl.depthFunc( gl.ALWAYS );
    this.quad.draw( context, program_state, null, this.standard_brdf );
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
      this.quad.draw( context, program_state, null, this.taa );
    }
    else
    {
      this.quad.draw( context, program_state, null, this.blit.override( { texture: this.render_buffers[ RenderBuffers.kPBRLighting ] } ) );
    }
  }

  render_handler_post_processing()
  {
    gl.bindFramebuffer( gl.FRAMEBUFFER, this.post_processing_buffer );
    gl.viewport( 0, 0, gl.canvas.width, gl.canvas.height );
    gl.clearColor( 0.0, 0.0, 0.0, 0.0 );
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
    gl.depthFunc( gl.ALWAYS );

    this.quad.draw( context, program_state, null, this.post_processing );
  }

  render_handler_copy_temporal()
  {
    gl.bindFramebuffer( gl.FRAMEBUFFER, this.accumulation_buffer );
    gl.viewport( 0, 0, gl.canvas.width, gl.canvas.height );
    gl.clearColor( 0.0, 0.0, 0.0, 0.0 );
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
    gl.depthFunc( gl.ALWAYS );

    this.quad.draw( context, program_state, null, this.blit.override( { texture: this.render_buffers[ RenderBuffers.kTAA ] } ) );

    gl.bindFramebuffer( gl.FRAMEBUFFER, this.velocity_prev );
    gl.viewport( 0, 0, gl.canvas.width, gl.canvas.height );
    gl.clearColor( 0.0, 0.0, 0.0, 0.0 );
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
    gl.depthFunc( gl.ALWAYS );

    this.quad.draw( context, program_state, null, this.blit.override( { texture: this.render_buffers[ RenderBuffers.kGBufferVelocity ] } ) );
  }

  render_handler_blit()
  {
    gl.bindFramebuffer( gl.FRAMEBUFFER, null );
    gl.viewport( 0, 0, gl.canvas.width, gl.canvas.height );
    gl.clearColor( 0.0, 0.0, 0.0, 0.0 );
    gl.clear( gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT );
    gl.depthFunc( gl.ALWAYS );

    this.blit.bind( { g_Sampler: this.blit_buffer } );
    this.quad.draw();
  }

  submit( scene )
  {
    this.prev_camera = scene.camera.transform.clone();

    if ( this.enable_taa )
    {
      this.taa_jitter = this.get_taa_jitter();
    }
    else
    {
      this.taa_jitter = Vector3( 0, 0, 0 );
    }

    this.render_handler_gbuffer( scene.actors );

    this.prev_camera = this.camera_inverse.clone();
      
    this.taa_jitter = Vector3( 0, 0, 0 );
    this.render_handler_directional_shadow( scene.actors );
    this.enable_pcf = this.enable_pcf;

    this.render_handler_lighting( scene.actors );
    this.render_handler_taa();
    this.render_handler_copy_temporal();
    this.render_handler_post_processing( scene.actors );
    this.render_handler_blit( scene.actors );

    this.frame_id++;
  }
};
