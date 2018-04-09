import { EXIF } from "exif-js";
import { createObjectURL, getTransform } from "./utils";

let MIME_TYPES = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  WEBP: "image/webp",
};

let MAX_STEPS = 4;
let SCALE_FACTOR = Math.log(2);
let SUPPORT_MIME_TYPES = Object.keys(MIME_TYPES).map(type => MIME_TYPES[type]);
let DEFAULT_TYPE = MIME_TYPES.JPEG;

function isSupportedType(type) {
  return SUPPORT_MIME_TYPES.includes(type);
}

export class Compress {
  constructor(option){
    this.config = Object.assign(
      {
        maxWidth: 1600,
        maxHeight: 1600,
        quality:0.92
      },
      option
    );
  }

  process(file){
    this.outputType = file.type;
    let srcDimension = {};
    let distDimension = {};

    if (!file.type.match(/^image/)) {
      return Promise.reject(new Error(`unsupport file type: ${file.type}`));
    } 
    if (!isSupportedType(file.type)) {
      this.outputType = DEFAULT_TYPE;
      console.warn(`unsupported MIME type ${file.type}, will fallback to default ${DEFAULT_TYPE}`);
    }

    return this.getOriginImage(file)
    .then(img => {
      srcDimension.width = img.width;
      srcDimension.height = img.height;
      return this.getOriginInfo(img);
    })
    .then(canvas => {
      // 计算图片缩小比例，取最小值，如果大于1则保持图片原尺寸
      let scale = Math.min(1, this.config.maxWidth / canvas.width, this.config.maxHeight / canvas.height);
      return this.drawImage(canvas, scale);
    })
    .then(result => {
      let newImageURL = result.toDataURL(this.outputType, this.config.quality);
      let distBlob = this.dataURLToBlob(newImageURL);
      distDimension.width = result.width;
      distDimension.height = result.height;
      if (distBlob.size > file.size){
        distBlob = file;
        distDimension = srcDimension;
      }
      return ({
        dist: {
          blob: distBlob,
          ...distDimension
        },
        source: {
          blob: file,
          ...srcDimension
        }
      });
    });
  }

  clear(ctx, width, height) {
    // jpeg 没有 alpha 通道，透明区间会被填充成黑色，这里把透明区间填充为白色
    if (this.outputType === DEFAULT_TYPE) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
    } else {
        ctx.clearRect(0, 0, width, height);
    }
  }
  // 通过 file 初始化 image 对象
  getOriginImage(file){
    return new Promise((resolve, reject) => {
      let url = createObjectURL(file);
      let img = new Image();
      img.src = url;
      img.onload = () => {
        resolve(img);
      };
      img.onerror = () => {
        reject("image load error");
      };
    });
  }

  getOriginInfo(img){
    return new Promise((resolve, reject) => {
      // 通过得到图片的信息来调整显示方向以正确显示图片，主要解决 ios 系统上的图片会有旋转的问题
      EXIF.getData(img, () => {
        let orientation = EXIF.getTag(img, "Orientation") || 1;
  
        let { width, height, matrix } = getTransform(img, orientation);
        let canvas = document.createElement("canvas");
        let context = canvas.getContext("2d");
        canvas.width = width;
        canvas.height = height;
        this.clear(context, width, height);
        context.transform(...matrix);
        context.drawImage(img, 0, 0);
        resolve(canvas);
      });
    });
  }

  drawImage(source, scale){
    if (scale === 1) {
      return Promise.resolve(source);
    }
    // 不要一次性画图，通过设定的 step 次数，渐进式的画图，这样可以增加图片的清晰度，防止一次性画图导致的像素丢失严重
    let sctx = source.getContext("2d");
    let steps = Math.min(MAX_STEPS, Math.ceil((1 / scale) / SCALE_FACTOR));

    let factor = Math.pow(scale, 1 / steps);

    let mirror = document.createElement("canvas");
    let mctx = mirror.getContext("2d");

    let { width, height } = source;

    mirror.width = width;
    mirror.height = height;

    let i = 0;

    while (i < steps) {
      let dw = width * factor | 0;
      let dh = height * factor | 0;

      let src, context;

      if (i % 2 === 0) {
        src = source;
        context = mctx;
      } else {
        src = mirror;
        context = sctx;
      }

      this.clear(context, width, height);
      context.drawImage(src, 0, 0, width, height, 0, 0, dw, dh);

      i++;
      width = dw;
      height = dh;

      if (i === steps) {
        // get current working canvas
        let canvas = src === source ? mirror : source;

        // save data
        let data = context.getImageData(0, 0, width, height);

        // resize
        canvas.width = width;
        canvas.height = height;

        // store image data
        context.putImageData(data, 0, 0);

        return Promise.resolve(canvas);
      }
    }
  }
  // 这里把 base64 字符串转为 blob 对象
  dataURLToBlob(dataURL){
    let buffer = atob(dataURL.split(",")[1]).split("").map(char => char.charCodeAt(0));
    let blob = new Blob([new Uint8Array(buffer)], { type: this.outputType });
    return blob;
  }
}