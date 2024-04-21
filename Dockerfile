FROM ubuntu:22.04

RUN apt-get update && \
    apt-get install -y python3 python3-pip cmake && \
    rm -rf /var/lib/apt/lists/*

RUN pip install crosshair-tool icontract

# Keep the container running
CMD ["tail", "-f", "/dev/null"]
