import express from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import bodyParser from "body-parser";
import axios from "axios";
import fs from "fs";
import path from "path";
import HTTPS from "https";
import dotenv from "dotenv";
import { Console } from "console";
import { logger } from "./logger";

dotenv.config();
const PORT = process.env.PORT;

const app = express();
const corsOption = {
  origin: "*",
  credentials: true,
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOption));
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(morgan("dev"));

// 파일다운로드 실행
const handleFileDownload = async (localPath, element) => {
  const url = element.file_url;
  const writer = fs.createWriteStream(localPath);

  const response = await axios({
    url,
    method: "GET",
    responseType: "stream",
  });

  // response data 쓰기 시작
  response.data.pipe(writer);
  // console.log(`Start Writing, ${localPath}`);

  return new Promise((resolve, reject) => {
    //writer.on('end', resolve(`${localPath}`));
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}; // end of handleFileDownload

// model3.json에 모션 정보 입력하기!
// 다운로드 다 받고 파일 저장하고 완료한 시점에 실행된다. (제일 마지막)
const handleMotionPush = (model3, list) => {
  // model3 에 Motions 오브젝트 변수 만들고.
  model3.FileReferences.Motions = {};

  list.forEach((item) => {
    if (item.file_name.includes(`.motion3.json`)) {
      let motionName = "";

      // 모션이 등록되지 않은 것도 처리한다.
      if (Object.keys(item).includes('motion_name') && item.motion_name ) motionName = item.motion_name;
      else motionName = item.file_name;

      // 키 값이 모션 혹은 파일 이름
      model3.FileReferences.Motions[motionName] = [];
      const fileObj = {
        File: item.file_name,
      };

      model3.FileReferences.Motions[motionName].push(fileObj);
    }
  }); // end of forEach
  // return 해준다.
  return model3;
};

// * 모션 리스트 처리
const updateMotionList = async (mainFile, list, res) => {
  logger.info(`updateMotionList ${mainFile}`);

  // 메인파일 읽어오기
  fs.readFile(mainFile, (err, data) => {
    if (err) {
      logger.error(`failed read file : ${JSON.stringify(err)}`);
      res.status(400).send(err);
      return;
    }

    let model3 = JSON.parse(data);
    model3 = handleMotionPush(model3, list);

    // 모델 처리 다 하고 파일 저장
    // 모션값을 추가해서 받은 model3를 다시 저장한다.
    fs.writeFile(mainFile, JSON.stringify(model3), (err) => {
      if (err) {
        logger.error(`failed write file : ${JSON.stringify(err)}`);
        logger.error(JSON.stringify(err));
        res.status(400).send(err);
      } else {
        // 여기가 진짜 끝..!
        res.status(200).json(model3);
      }
    });
  });
};

// * 다운로드 요청 처리
const handleRequest = async (req, res) => {
  const {
    body: { list },
  } = req;

  console.log(`handleRequest`);

  const downloadPromise = []; // 다운로드 Promise
  const savedFiles = []; // 저장된 모든 파일의 경로
  let mainFile = ``; // 메인 모델 json 파일 경로

  // 경로 잘 체크할것.
  const parentRootPath = path.resolve(
    __dirname,
    `../../Resources/`
  );

  console.log(`root path : [${parentRootPath}]`);

  list.forEach(async (element) => {
    const localPath = path.resolve(parentRootPath, element.file_key);
    console.log(`expected localPath : ${localPath}`);

    // 메인 파일 저장.
    if (localPath.includes(`.model3.json`)) {
      mainFile = localPath;
      savedFiles.push(localPath); // 그냥 메인 파일 하나만 보내면 되겠네.
    }

    const dirName = localPath.replace(element.file_name, ""); // 디렉토리만 남겨놓고 파일 이름을 제거
    // 디렉토리 없으면 만들기.
    if (!fs.existsSync(dirName)) {
      // console.log(`removed ${element.file_name} and creating path ${dirName}`);
      fs.mkdir(dirName, { recursive: true }, (err) => {
        if (err) {
          console.log(err);
          return;
        }

        // console.log(`dir created ${dirName}`);
        downloadPromise.push(handleFileDownload(localPath, element));
      });
    } else {
      // 있으면 바로 파일 다운로드 진행
      //   console.log(`dir exists ${dirName}`);
      downloadPromise.push(handleFileDownload(localPath, element));
    }
  }); // ? end of list foreach

  logger.info(`Promise Count : ${downloadPromise.length}`);

  // Promise.all 실행
  await Promise.all(downloadPromise)
    .then((values) => {
      // 이 시점에 다운로드가 완료되고, 로컬에 파일을 생성 했음. (다!)
      console.log("Download Done!");
      
      setTimeout( () => {
        console.log('Update motion list!');
        updateMotionList(mainFile, list, res);  
      }, 1500)
      
      
    })
    .catch((err) => {
      console.log(err);
      res.status(400).send(err);
    });

  // res.status(200).send("OK");
};

//////////////////////////
//////////////////////////
//////////////////////////

const handleListening = () => {
  console.log(`Listening on fileDownLoad Server`);
};

app.use("/request", handleRequest);

// https 처리 추가
const is_https = process.env.HTTPS;
if (is_https > 0) {
  const option = {
    ca: fs.readFileSync("./cert/ca-chain-bundle.pem"),
    key: fs.readFileSync("./cert/key.pem"),
    cert: fs.readFileSync("./cert/crt.pem"),
  };

  console.log("this is https!!! env", PORT);

  HTTPS.createServer(option, app).listen(PORT, handleListening);
} else {
  console.log("this is http env", PORT);
  app.listen(PORT, handleListening);
}
